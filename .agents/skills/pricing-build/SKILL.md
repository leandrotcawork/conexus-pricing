---
name: pricing-build
description: "Builds one unit of an approved conexus-pricing card as one commit, or fixes a defect:
deletes before adding, ports MetalPrice logic only as the card names, builds each reference row as
its verdict says, tests through a public door with recorded store doubles and a disposable
database, runs the result, and reports what ran and what was not proved. Use when instructions name
a card and a unit, or a defect."
---

# Build

## Before code
Read `AGENTS.md`, this skill, the card's unit section and its rows; load pstack `poteto-mode` and
`typescript-best-practices`; for a store platform, `pricing-adapter`. Create `criteria.json`
outside the repository: one item per criterion with its test and state. [conexus-build/SKILL.md:17-21;
references/brief.md:93-96]

## Steps
1. Every type and value the unit needs exists or comes from this unit; else stop. [:28-29]
2. Delete before adding; no shim or parallel path. [:35-36]
3. Port from MetalPrice only the logic the card names, into the named file, with its comment of
   why (the trap it avoids) and without its Python shapes. [references/bring.md:134-150, adapted]
4. Build each row as its verdict says; open the reference at its `file:line` first and note it in
   `criteria.json`. [:30-34; references/brief.md:106-107]
5. Test through the public door: the Function's `fetch`, the MCP client, the script. Store answers
   come from recordings; a shape no recording holds stops the work. [:40-41; testing T29]
6. Run it: migrations on a disposable PostgreSQL 18, the Function locally (`neon dev` or a direct
   `fetch` call), a real MCP client call. Hand-mutate key lines (T27). Run `deslop` and
   `no-comments`. [:42-48]
7. One commit; `npm run check` and `npm test` green before it. [:49-50]

## A defect
Reproduce first on the real artifact, find the first wrong state, write the failing test, fix the
cause, sweep the class. [references/bug.md:166-180]

## Stop and ask
A missing decision; a criterion that cannot pass without changing the card; a file, shape or row
the section does not name; the unit outgrowing its estimate. Stop means no more code: report the
evidence. [:59-71]
