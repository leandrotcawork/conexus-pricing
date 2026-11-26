# conexus-pricing

Coleta os preços que a Telha Norte, a Condec e a ABC cobram pelos produtos do catálogo da empresa e
os entrega a agentes por MCP. Roda no Neon: Postgres, uma Function que coleta cada loja toda semana
e uma Function que serve o MCP.

## Estado

Etapa E3. A Function de coleta roda a rodada de uma loja quando o gatilho do Neon a chama: pergunta
cada produto do catálogo à Telha Norte (VTEX), à Condec (Tray) ou à ABC (Wake) e grava o que ela
respondeu. As migrações criam o schema `precos`, as duas roles e as três lojas. A Function de MCP por
enquanto só responde que está de pé. A carga do catálogo (E2), as ferramentas MCP (E4) e a agenda (E5)
ainda não existem aqui.

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
   ```

6. Se quiser, grave o token reserva da ABC. É o valor que o site da loja envia no cabeçalho
   `TCS-Access-Token`, visível nas requisições do navegador. A coleta lê o token da home da loja a cada
   rodada e só usa o reserva quando não o acha, com o aviso `TOKEN_RESERVA_EM_USO`. Sem token na home e
   sem reserva, a rodada da ABC fecha como `FALHOU`, com o aviso `PREPARO_FALHOU` e o motivo. Rode como
   dono do banco, no editor SQL do Neon:

   ```sql
   UPDATE precos.fonte
   SET config = config || jsonb_build_object('tokenReserva', '<token>')
   WHERE codigo = 'abc';
   ```

A carga do catálogo (`scripts/carga-catalogo.ts`) entra na etapa E2.

## Rodar uma loja à mão

Cada loja tem uma rota na Function de coleta: `POST /telhanorte`, `POST /condec` e `POST /abc`. Só o
gatilho do Neon consegue chamá-la, porque o Neon apaga os cabeçalhos `X-Neon-*` de quem chama de fora.
Um `curl` recebe 401. Para rodar uma loja agora, crie um gatilho com um horário alguns minutos à
frente, em UTC (minuto, hora, dia e mês fixos), e apague-o depois que ele disparar:

```sh
npx neon triggers create --function-slug coleta --name manual-telhanorte \
  --function-path /telhanorte --cron '<minuto> <hora> <dia> <mês> *'
npx neon triggers list
npx neon triggers delete <id do gatilho>
```

A rodada fica em `precos.rodada`, com a situação, as contagens por situação e os avisos. Entregar o
mesmo horário outra vez não a duplica. Uma rodada para de pedir à loja aos 13 minutos. O que não coube
fica para a entrega seguinte, que o Neon faz sozinho depois da resposta 503.

## Gravar as respostas de uma loja

Os testes respondem no lugar das lojas com respostas gravadas em `src/plataformas/<plataforma>/gravacoes/`,
com preços, nomes, endereços, EANs e token trocados por inventados. Para gravar de novo, com dois EANs
que a loja vende:

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
`oracledb` só em `scripts/carga-catalogo.ts`, e `src/dominio/` importa só `zod`. Entre as pastas,
cada uma importa só os seus arquivos e: `src/plataformas/` e `src/banco/`, `dominio/`;
`src/coleta/`, `dominio/`, `plataformas/` e `banco/`; `src/mcp/`, `dominio/` e `banco/leituras.ts`;
`src/funcoes/`, `config.ts`, `coleta/` e `mcp/`; `scripts/carga-catalogo.ts`, `dominio/` e `banco/`.
Os testes (`*.test.ts`) ficam fora das paredes entre pastas, porque entram pelas portas públicas.

As regras de código herdadas do Conexus estão em [`docs/regras.md`](docs/regras.md). As instruções
para agentes, e as cinco skills do método (`pricing-study`, `pricing-scope`, `pricing-build`,
`pricing-review`, `pricing-adapter`), estão em [`AGENTS.md`](AGENTS.md) e `.agents/skills/`.
