# conexus-pricing

Coleta os preços que a Telha Norte, a Condec e a ABC cobram pelos produtos do catálogo da empresa e
os entrega a agentes por MCP. Roda no Neon: Postgres, uma Function que coleta cada loja toda semana
e uma Function que serve o MCP.

## Estado

Etapa E2. Existem o domínio em `src/dominio/`, o banco (schema `precos`, duas roles e a migração), o
cliente HTTP sobre o Crawlee, as duas Functions, que por enquanto só respondem que estão de pé, e a
carga do catálogo a partir do Sankhya. A Function de coleta também mede o alcance das três lojas.
Adaptadores das lojas, ferramentas MCP e agenda entram nas etapas E3 a E5.

| Etapa | Entrega |
| --- | --- |
| E0 | Esqueleto com CI verde |
| E1 | Banco e as duas Functions no ar |
| E2 | Carga do catálogo |
| E3 | Os três adaptadores e o runner, sem agenda |
| E4 | MCP com as quatro ferramentas |
| E5 | Agenda semanal e paridade com o MetalPrice |

## Como rodar

Node 24.21.0 (`.nvmrc`), npm, `openssl` e um PostgreSQL 18 descartável para os testes.

```sh
docker run --rm -d --name precos-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5432:5432 postgres:18
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm ci
npm run check          # Biome, tsc e knip
npx drizzle-kit check  # histórico de migrações consistente
npm test               # node:test, com tempo máximo global
```

Os testes criam bancos e **redefinem a senha das roles `precos_coletor` e `precos_leitor` no servidor
inteiro**. Aponte `TEST_DATABASE_URL` só para um servidor descartável, nunca para o Neon.

Depois de mudar `src/banco/tabelas.ts`, gere a migração com `npx drizzle-kit generate`.

O teste da carga contra um Oracle fica pulado sem `TEST_ORACLE_HOST`, inclusive no CI. Para rodá-lo,
suba um Oracle local (o contêiner usa cerca de 2 GB de memória), tenha o Instant Client (ver
[Carga do catálogo](#carga-do-catálogo)) e defina:

```sh
docker run --rm -d --name precos-oracle -p 127.0.0.1:1521:1521 \
  -e ORACLE_PASSWORD=SoParaTeste1 gvenzl/oracle-free:23-slim-faststart
export TEST_ORACLE_HOST=127.0.0.1 TEST_ORACLE_SERVICE_NAME=FREEPDB1
export TEST_ORACLE_SYSTEM_PASSWORD=SoParaTeste1
export LD_LIBRARY_PATH=/caminho/do/instantclient
npm test
```

O teste cria dois usuários novos no Oracle, com tabelas e dados inventados, e os apaga no fim.
`TEST_ORACLE_PORT` muda a porta (sem ela, 1521).

## Publicar no Neon

A publicação não roda no CI. Cada uma é feita à mão, com a autorização do responsável pelo projeto.

1. Ligue a pasta ao projeto e traga as variáveis do Neon, entre elas `DATABASE_URL_UNPOOLED`:

   ```sh
   npx neon auth
   npx neon link
   npx neon env pull --file .env.local
   ```

2. Acrescente ao `.env.local`, que o Git ignora:

   | Variável | Valor |
   | --- | --- |
   | `COLETOR_DATABASE_URL` | A URL com pooler do banco, com o usuário `precos_coletor` e uma senha sua |
   | `LEITOR_DATABASE_URL` | A mesma URL, com o usuário `precos_leitor` e outra senha |
   | `ALCANCE_TOKEN` | Um segredo de 32 caracteres ou mais para a rota de alcance |

   `openssl rand -hex 24` gera um valor que o Neon aceita como senha e que não precisa de escape na URL.

3. Aplique as migrações. O comando cria o que falta e define a senha de cada role a partir da URL
   correspondente. Rodar de novo não aplica nada.

   ```sh
   npm run migrar
   ```

4. Publique as duas Functions:

   ```sh
   npx neon deploy --env .env.local
   ```

5. Confira. `npx neon functions get coleta` e `npx neon functions get mcp` mostram a URL de cada uma.
   `GET /` responde `{"dePe":true,...}` quando a Function entra no banco com a própria role.

   ```sh
   curl "$URL_DA_COLETA/"
   curl "$URL_DO_MCP/"
   curl -X POST "$URL_DA_COLETA/_alcance" \
     -H "Authorization: Bearer $ALCANCE_TOKEN" \
     -d '{"ean":"<um EAN que as lojas vendem>","tokenAbc":"<token da loja>"}'
   ```

   A rota de alcance faz um pedido a cada loja e devolve o status e o tempo de cada uma. O `tokenAbc` é
   o valor que o site da ABC envia no cabeçalho `TCS-Access-Token`, visível nas requisições do navegador.

## Carga do catálogo

A carga (`scripts/carga-catalogo.ts`) lê o Sankhya, escolhe o recorte e grava `precos.produto`. Ela é
única: não há sincronização, e o catálogo só muda quando alguém a roda de novo, à mão.

No Sankhya ela só faz `SELECT`, numa transação `READ ONLY` que termina em `rollback`. A saída são só
contagens: produtos do recorte, quantos estão sem nosso preço, cada classe com o acumulado e o total
de linhas em `precos.produto`.

### O recorte

| Regra | Definição |
| --- | --- |
| Universo | Produto ativo com EAN de 12 a 14 dígitos em `TGFPRO.REFERENCIA` |
| Venda líquida, 12 meses | Itens de nota de venda (`V`) liberada, `VLRTOT − VLRDESC`, menos as devoluções (`D`) liberadas |
| Compra, 12 meses | Existe nota de compra (`C`) ou pedido de compra (`O`) liberado |
| Operação comercial | Pela descrição mais recente no `TGFTOP`; os trechos que excluem estão em `src/dominio/recorte.ts` |
| Curva ABC | Produtos em ordem de venda líquida: A com acumulado anterior abaixo de 80% do total, B abaixo de 95%, C no resto. Sem venda líquida positiva, é C e não entra no total |
| Recorte | Classes A e B, mais os da classe C com compra |
| Nosso preço | Tabela 0, na versão vigente mais recente que contém o produto; preço zero é ausência |

### Antes de rodar

1. O banco do Neon já migrado e o `.env.local` com `DATABASE_URL_UNPOOLED` (passos 1 a 3 de
   [Publicar no Neon](#publicar-no-neon)).
2. O Oracle Instant Client para Linux x64 (pacote Basic ou Basic Light), descompactado, e a `libaio`.
   No Ubuntu 24.04 ou mais novo:

   ```sh
   sudo apt install libaio1t64
   ln -s /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /caminho/do/instantclient/libaio.so.1
   ```

3. As variáveis do Sankhya, no ambiente ou no `.env.local`. Um valor com `#` ou espaço vai entre
   aspas.

   | Variável | Valor |
   | --- | --- |
   | `SANKHYA_ORACLE_HOST` | Servidor do Oracle |
   | `SANKHYA_ORACLE_PORT` | Porta; sem ela, 1521 |
   | `SANKHYA_ORACLE_SERVICE_NAME` | Nome do serviço |
   | `SANKHYA_ORACLE_USER` | Um usuário com `SELECT` nas tabelas abaixo |
   | `SANKHYA_ORACLE_PASSWORD` | A senha dele |
   | `SANKHYA_ORACLE_SCHEMA` | O dono das tabelas `TGFPRO`, `TGFTOP`, `TGFCAB`, `TGFITE`, `TGFTAB` e `TGFEXC` |

### Rodar

```sh
LD_LIBRARY_PATH=/caminho/do/instantclient npm run carga
```

`LD_LIBRARY_PATH` vai no próprio comando: o Linux o lê antes de o Node abrir o `.env.local`. Sem ele a
carga para em `DPI-1047` e não grava nada.

Rodar de novo atualiza os produtos pelo código e não cria linha repetida. Um produto que saiu do
recorte entre uma carga e outra continua na tabela.

## Como o código se organiza

Um pacote só, `src/` dividido em pastas com dono. As paredes entre elas são regras do Biome
(`noRestrictedImports` em `biome.json`): `pg` e `@neon/functions` só em `src/banco/conexao.ts`,
`@crawlee/http` só em `src/coleta/http.ts`, `@modelcontextprotocol/server` só em `src/mcp/`,
`oracledb` só em `scripts/carga-catalogo.ts` (e no teste dele, que monta o Oracle de mentira), e
`src/dominio/` importa só `zod`. Entre as pastas,
cada uma importa só os seus arquivos e: `src/plataformas/` e `src/banco/`, `dominio/`;
`src/coleta/`, `dominio/`, `plataformas/` e `banco/`; `src/mcp/`, `dominio/` e `banco/leituras.ts`;
`src/funcoes/`, `config.ts`, `coleta/` e `mcp/`; `scripts/carga-catalogo.ts`, `dominio/`, `banco/` e
`config.ts`.
Os testes (`*.test.ts`) ficam fora das paredes entre pastas, porque entram pelas portas públicas.

As regras de código herdadas do Conexus estão em [`docs/regras.md`](docs/regras.md). As instruções
para agentes, e as cinco skills do método (`pricing-study`, `pricing-scope`, `pricing-build`,
`pricing-review`, `pricing-adapter`), estão em [`AGENTS.md`](AGENTS.md) e `.agents/skills/`.
