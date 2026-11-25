# conexus-pricing

Coleta os preços que a Telha Norte, a Condec e a ABC cobram pelos produtos do catálogo da empresa e
os entrega a agentes por MCP. Roda no Neon: Postgres, uma Function que coleta cada loja toda semana
e uma Function que serve o MCP.

## Estado

Etapa E1. Existem o domínio em `src/dominio/`, o banco (schema `precos`, duas roles e a migração), o
cliente HTTP sobre o Crawlee e as duas Functions, que por enquanto só respondem que estão de pé. A
Function de coleta também mede o alcance das três lojas. Carga do catálogo, adaptadores das lojas,
ferramentas MCP e agenda entram nas etapas E2 a E5.

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

A carga do catálogo (`scripts/carga-catalogo.ts`) entra na etapa E2.

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
