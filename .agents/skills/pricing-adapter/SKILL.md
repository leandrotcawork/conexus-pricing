---
name: pricing-adapter
description: "The conexus-pricing pattern for a store platform adapter: the contract in
src/plataformas/contrato.ts, the registry, the Zod schemas of the store's answers, the recordings,
the conformance suite every adapter passes, and the rule that a failure never becomes a price. Use
whenever a task adds, changes, studies, scopes or reviews anything under src/plataformas/."
---

# Store adapter

## What an adapter is
One value in `ADAPTADORES`: it parses its `fonte.config`, builds requests and reads answers. It never
calls HTTP, never decides the price (that is `decidir()` in `src/dominio/observacao.ts`) and never
touches the database. A new platform adds a folder, a registry line and an enum value; no runner
code. [conexus-connector/SKILL.md:16-19, adapted]

## Steps to add one
1. Read the platform's public API page or the store's own storefront calls; prefer a route that
   filters by EAN on the server. Record `robots.txt` for the route. [references/add.md:168-177]
2. Record real answers with `scripts/gravar.ts`: one batch, one empty, one truncated or erroring,
   one 429 if the store sends one; swap every value for an invented one (S40). No recording, no
   adapter. [add.md:204-210; testing T29]
3. Write `respostas.ts` (Zod of only the fields a recording holds) and `adaptador.ts` (`abrir`,
   `pedido`, `ler`). Only offers whose published EAN equals the asked EAN count.
4. Pass `conformidade.ts` and the adapter's own tests.
5. Add the source row (`fonte`) by migration with its config, and its schedule in `neon.ts`.

## Review checklist
- No store route, field or token outside its folder. [references/checklist.md:264-267]
- Every answer shape a test feeds has its recording. [:294-295]
- A truncated or erroring answer is `INVALIDO`, never an empty batch.
- A port from MetalPrice keeps the reason of each trap it avoids and cites the old file and line.
