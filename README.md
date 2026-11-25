# conexus-pricing

Coleta os preços que a Telha Norte, a Condec e a ABC cobram pelos produtos do catálogo da empresa e
os entrega a agentes por MCP. Roda no Neon: Postgres, uma Function que coleta cada loja toda semana
e uma Function que serve o MCP.

## Estado

Etapa E0 (esqueleto). Existem o domínio em `src/dominio/` (marcas, situações da observação e a regra
`decidir()` do mais barato disponível), a configuração de qualidade e o CI. Banco, coleta, adaptadores
das lojas, carga do catálogo e MCP entram nas etapas E1 a E5.

| Etapa | Entrega |
| --- | --- |
| E0 | Esqueleto com CI verde |
| E1 | Banco e as duas Functions no ar |
| E2 | Carga do catálogo |
| E3 | Os três adaptadores e o runner, sem agenda |
| E4 | MCP com as quatro ferramentas |
| E5 | Agenda semanal e paridade com o MetalPrice |

## Como rodar

Node 24.21.0 (`.nvmrc`) e npm.

```sh
npm ci
npm run check   # Biome, tsc e knip
npm test        # node:test, com tempo máximo global
```

A carga do catálogo (`scripts/carga-catalogo.ts`) e a publicação no Neon passam a existir nas etapas E1
e E2; este arquivo ganha os comandos quando elas chegarem.

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
