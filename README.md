# conexus-pricing

Coleta os preços que os concorrentes cobram pelos produtos do catálogo da empresa e os entrega a
agentes por MCP. Roda no Neon: Postgres, uma Function que coleta cada loja toda semana e uma Function
que serve o MCP.

## Estado

Etapa E4b. A carga do catálogo lê o Sankhya e grava os grupos de produto e os produtos, cada um com
o grupo, a classe ABC e a venda de 12 meses. A Function de coleta roda a rodada de uma loja quando o
gatilho do Neon a chama: pergunta a ela cada produto do catálogo e grava o que ela respondeu. A
Function de MCP serve cinco ferramentas de leitura, com os indicadores contra a concorrência já
calculados, e a skill que ensina a analisá-los. A agenda semanal (E5) ainda não existe aqui. As
migrações criam o schema `precos`, as duas roles e as lojas abaixo.

| Código | Loja | Plataforma |
| --- | --- | --- |
| `telhanorte` | Telha Norte | VTEX |
| `condec` | Condec | Tray |
| `abc` | ABC da Construção | Wake |
| `balaroti` | Balaroti | Wake |
| `copafer` | Copafer | VTEX |
| `queroquero` | Quero-Quero | VTEX |
| `amoedo` | Amoedo | VTEX |

| Etapa | Entrega |
| --- | --- |
| E0 | Esqueleto com CI verde |
| E1 | Banco e as duas Functions no ar |
| E2 | Carga do catálogo |
| E3 | Os três adaptadores e o runner, sem agenda |
| E4 | MCP com as quatro primeiras ferramentas |
| E4b | Grupo, classe e venda no catálogo; cinco ferramentas com indicadores; skill servida pelo MCP |
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
   | `MCP_TOKEN` | O token que o cliente do MCP envia: 32 caracteres ou mais, sem espaço. `openssl rand -hex 32` gera um |

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

   Num banco que já tinha o catálogo, rode a [carga](#carga-do-catálogo) de novo depois de migrar:
   até lá os produtos ficam sem grupo, classe e venda, e o índice ponderado vem vazio.

5. Confira. `npx neon functions get coleta` e `npx neon functions get mcp` mostram a URL de cada uma.
   Na coleta, `GET /` responde `{"dePe":true,...}` quando a Function entra no banco com a própria role.
   O MCP só tem a rota `/mcp`: sem o token ela responde 401, o que mostra que a Function subiu. Que ela
   lê o banco, quem mostra é a ferramenta `saude_coleta`, depois de [conectar o
   Claude](#conectar-o-claude-ao-mcp).

   ```sh
   curl "$URL_DA_COLETA/"
   curl -i -X POST "$URL_DO_MCP/mcp"
   ```

6. Se quiser, grave o token reserva da ABC. É o valor que o site da loja envia no cabeçalho
   `TCS-Access-Token`, visível nas requisições do navegador. A coleta lê o token da home da loja a cada
   rodada e só usa o reserva quando não o acha, com o aviso `TOKEN_RESERVA_EM_USO`. Sem token na home e
   sem reserva, a rodada da ABC fecha como `FALHOU`, com o aviso `PREPARO_FALHOU` e o motivo. A
   Balaroti também é Wake e segue as mesmas regras, com o token e o código dela. Rode como dono do
   banco, no editor SQL do Neon:

   ```sql
   UPDATE precos.fonte
   SET config = config || jsonb_build_object('tokenReserva', '<token>')
   WHERE codigo = 'abc';
   ```

## Conectar o Claude ao MCP

O endereço é a URL da Function `mcp` seguida de `/mcp`. Todo pedido leva o cabeçalho
`Authorization: Bearer <token>`, com o valor de `MCP_TOKEN` que foi publicado. Sem ele, a resposta
é 401. Há um token só: para trocá-lo, mude `MCP_TOKEN`, publique de novo e reconecte o cliente.

No Claude Code, com `URL_DO_MCP` e `MCP_TOKEN` definidos no terminal:

```sh
claude mcp add --transport http precos "$URL_DO_MCP/mcp" --header "Authorization: Bearer $MCP_TOKEN"
claude mcp list
```

O Claude Code guarda o cabeçalho na própria configuração, fora deste repositório.

No claude.ai e no app, o conector personalizado envia um cabeçalho fixo pela seção **Request
headers**, em beta: nome `authorization`, valor `Bearer ` seguido do token, sem login. Se a seção não
aparecer, a conta ainda não tem o recurso. Ver
[a documentação do conector](https://claude.com/docs/connectors/custom).

Depois, pergunte em português: "qual categoria está mais cara que o mercado?", "em quantos produtos
somos os mais baratos?" ou "a coleta da semana está saudável?".

### A skill de análise

O servidor entrega a skill [`analise-precos`](skills/analise-precos/SKILL.md) pela extensão
`io.modelcontextprotocol/skills`: as definições dos indicadores, a ordem de trabalho e o que não dá
para concluir. As instruções do servidor mandam o agente carregá-la antes de analisar.

No Claude Code ela aparece como `/precos:analise-precos`, e o modelo a carrega quando o assunto pede,
com a sua aprovação. O recurso está em beta e tem condições
([documentação](https://code.claude.com/docs/en/mcp)):

- Claude Code 2.1.331 ou mais novo.
- Entrada por `/login` num plano Pro, Max ou Ultra. Em Team ou Enterprise, só depois que a
  organização ligar o recurso.
- Não funciona com chave de API, com `claude -p` nem no Agent SDK.

No Conexus, ou noutro agente em Mastra, use o `MCPClient` com `forwardInstructions: true` no servidor
`precos`. O cliente ainda não fala a extensão: leia a skill com
`mcp.resources.read('precos', 'skill://analise-precos/SKILL.md')` e passe o texto ao `createSkill`. O
Mastra prefixa o nome do servidor nas ferramentas (`precos_buscar_produtos`).

### As ferramentas

| Ferramenta | Responde |
| --- | --- |
| `buscar_produtos` | Até 50 códigos ou EANs de uma vez, ou texto, marca e grupo (com os subgrupos), 50 por página |
| `grupos_produto` | A árvore de categorias, com quantos produtos cada uma tem e quantos têm preço de concorrente |
| `precos_atuais` | Para até 50 produtos, o que a última rodada `CONCLUIDA` ou `SUSPEITA` de cada loja ativa viu; URL e vendedor só com `detalhes` |
| `panorama_precos` | Indicadores de produtos, um grupo, uma marca ou o catálogo, por produto, grupo, marca ou loja: índice, gap para o menor, posição, cobertura, promoção, ruptura, mudanças e tendência |
| `saude_coleta` | A última rodada de cada loja: situação, contagens, avisos, idade e cobertura do catálogo |

`NAO_ENCONTRADO` quer dizer que a loja não vende o produto. `ERRO` quer dizer que a coleta falhou, e
não se sabe o preço. As duas situações chegam separadas ao agente. Os indicadores usam só preços
`OK`. Mudanças pedem 4 semanas de coleta e tendência pede 8: antes disso vêm vazias, e o panorama
avisa.

## Carga do catálogo

A carga (`scripts/carga-catalogo.ts`) lê o Sankhya, escolhe o recorte e grava `precos.grupo` e
`precos.produto`, numa transação só. Ela é única: não há sincronização, e o catálogo só muda quando
alguém a roda de novo, à mão.

No Sankhya ela só faz `SELECT`, numa transação `READ ONLY` que termina em `rollback`. A saída são só
contagens: produtos do recorte, quantos estão sem nosso preço, cada classe com o acumulado, grupos de
produto, grupos inativos de pai inexistente gravados como raiz, produtos sem grupo, produtos em grupo
sintético e o total de linhas em `precos.produto`.

Se um grupo ativo aponta para um pai que não existe no `TGFGRU`, ou um produto do recorte aponta para
um grupo que não existe, a carga não grava nada e diz quantos são. Um grupo inativo (`ATIVO` = `N`)
de pai inexistente não para a carga: é gravado como raiz, com o pai nulo, e a saída diz quantos foram.

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
| Grupo | `TGFPRO.CODGRUPOPROD`. A árvore `TGFGRU` é gravada inteira, com o pai de cada grupo. Pai nulo ou `-999999999`, o "sem pai" do Sankhya, é raiz. Grupo inativo de pai inexistente também é gravado como raiz |
| Gravado no produto | A classe da curva e a venda líquida de 12 meses, o peso do índice ponderado; negativa vira zero |

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
   | `SANKHYA_ORACLE_SCHEMA` | O dono das tabelas `TGFPRO`, `TGFGRU`, `TGFTOP`, `TGFCAB`, `TGFITE`, `TGFTAB` e `TGFEXC` |

### Rodar

```sh
LD_LIBRARY_PATH=/caminho/do/instantclient npm run carga
```

`LD_LIBRARY_PATH` vai no próprio comando: o Linux o lê antes de o Node abrir o `.env.local`. Sem ele a
carga para em `DPI-1047` e não grava nada.

Rodar de novo atualiza grupos e produtos pelo código e não cria linha repetida. Um produto que saiu
do recorte, ou um grupo que saiu do Sankhya, continua na tabela.

## Rodar uma loja à mão

Cada loja tem uma rota na Function de coleta, `POST /<código>`. Só o gatilho do Neon consegue
chamá-la, porque o Neon apaga os cabeçalhos `X-Neon-*` de quem chama de fora.
Um `curl` recebe 401. Para rodar uma loja agora, crie um gatilho com um horário alguns minutos à
frente, em UTC (minuto, hora, dia e mês fixos), e apague-o depois que ele disparar:

```sh
npx neon triggers create --function-slug coleta --name manual-telhanorte \
  --function-path /telhanorte --cron '<minuto> <hora> <dia> <mês> *'
npx neon triggers list
npx neon triggers delete <id do gatilho>
```

A rodada fica em `precos.rodada`, com a situação, as contagens por situação e os avisos. Uma rodada
sem nenhum `OK` e com algum `ERRO` fecha como `FALHOU`, com o aviso `NENHUM_OK`: ela não vira preço
atual nem base de comparação, e a loja é perguntada de novo na rodada seguinte. Entregar o mesmo
horário outra vez não a duplica. Uma rodada para de pedir à loja aos 13 minutos. O que não coube
fica para a entrega seguinte, que o Neon faz sozinho depois da resposta 503.

## Ensaiar um lote numa loja

Antes de contar com uma loja, pergunte a ela um lote de EANs do catálogo, sem banco e sem Neon:

```sh
node scripts/lote-loja.ts <código> <arquivo>
```

O arquivo tem um EAN por linha e fica fora do repositório. O script lê a config da loja nas migrações,
sem o `tokenReserva` que só existe no banco, pergunta com as regras da rodada e faz uma pausa de 2 a
4 segundos entre os pedidos. A saída são só as contagens por situação (`OK`, `SEM_ESTOQUE`,
`SEM_PRECO`, `NAO_ENCONTRADO`, `ERRO`) e o tempo. `SEM_RESPOSTA` aparece quando o prazo de 13 minutos
acaba antes do último EAN.

As contagens não mostram os preços. Uma loja que publica preço de preenchimento aparece como `OK`.

## Gravar as respostas de uma loja

Os testes respondem no lugar das lojas com respostas gravadas em `src/plataformas/<plataforma>/gravacoes/`,
com preços, nomes, endereços, EANs e token trocados por inventados. Telha Norte, Condec e ABC ficam na
própria pasta; cada outra loja, numa subpasta com o código dela, escolhida com `--destino`. Para gravar
de novo, com dois EANs que a loja vende:

```sh
node scripts/gravar.ts vtex '{"origem":"https://www.telhanorte.com.br","lote":50}' <ean> <ean>
node scripts/gravar.ts tray '{"origem":"https://www.condec.com.br","lote":25}' <ean> <ean>
node scripts/gravar.ts wake '{"loja":"https://www.abcdaconstrucao.com.br","api":"https://storefront-api.fbits.net/graphql","lote":25}' <ean> <ean>
```

O script faz um pedido por caso, com três segundos entre eles. Com `--cru <pasta fora do repositório>`,
as respostas originais ficam guardadas e a próxima execução não pede de novo. Essas pastas têm dados
reais e não entram no Git.

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
A skill servida pelo MCP está em `skills/analise-precos/SKILL.md`; no empacotamento da Function,
`scripts/empacotar.ts` coloca o texto dentro do `index.mjs`.
Os testes (`*.test.ts`) ficam fora das paredes entre pastas, porque entram pelas portas públicas.

As regras de código herdadas do Conexus estão em [`docs/regras.md`](docs/regras.md). As instruções
para agentes, e as cinco skills do método (`pricing-study`, `pricing-scope`, `pricing-build`,
`pricing-review`, `pricing-adapter`), estão em [`AGENTS.md`](AGENTS.md) e `.agents/skills/`.
