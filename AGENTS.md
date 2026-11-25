# conexus-pricing: instructions for agents

conexus-pricing collects competitors' prices for the founder's catalog and serves them to agents
over MCP. It runs on Neon: Postgres, one Function that collects each source on a weekly schedule,
and one Function that serves MCP. The architecture card is `docs/etapas/` plus this file.

## Which skill for which stage

| Stage | Skill |
| --- | --- |
| Study a step | [`pricing-study`](.agents/skills/pricing-study/SKILL.md) |
| Write the step's card | [`pricing-scope`](.agents/skills/pricing-scope/SKILL.md) |
| Build a unit, or fix a defect | [`pricing-build`](.agents/skills/pricing-build/SKILL.md) |
| Review a pull request or a whole step | [`pricing-review`](.agents/skills/pricing-review/SKILL.md) |
| Add or change a store platform | [`pricing-adapter`](.agents/skills/pricing-adapter/SKILL.md), beside the stage skill |

## Commands

`package.json` lists them. Before a commit: `npm run check` (Biome, tsc, knip) and `npm test`
(needs `TEST_DATABASE_URL`, a disposable PostgreSQL 18).

## Rules for every task

- A failure never becomes a price. Every observation is one of the closed situations, and the
  database CHECKs refuse an `OK` without a price.
- Only `src/plataformas/<platform>/` knows a store's routes and fields. Only `src/coleta/http.ts`
  imports Crawlee, only `src/banco/conexao.ts` imports `pg`, only `src/config.ts` reads `process.env`.
- External data is parsed once with Zod at its edge, then trusted.
- Every test enters through a public door: a Function's `fetch`, the MCP client, or a script.
  A store double serves bodies recorded from the real store with invented values.
- Conexus rules apply by identifier as `docs/regras.md` lists; cite them, never restate them.
- A missing decision stops the work: report it with evidence. Never invent a product rule or a
  value to make a test pass.
- No company data, secret or machine path in code, tests, docs, commits or pull requests.
- People-facing text (README, cards, MCP tool descriptions) is Portuguese; this file and the skills
  stay English.
- Merge only with the founder's word, through firstmate.
