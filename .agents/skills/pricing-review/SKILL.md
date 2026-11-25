---
name: pricing-review
description: "Reviews a conexus-pricing pull request at its exact commit as a reviewer that did not
build it, or a whole step once: reads the rules, every file of the diff against the card, walks the
reference rows against the installed versions, tries a counterexample to every criterion, runs the
refusals against a real database, calls the MCP tools with a real client when the step touches
them, labels each finding Bloqueia, Fechamento or Issue futura, and gives one verdict with file and
line. Use when instructions name a pull request or a step to review."
---

# Review

## Steps
1. Read `AGENTS.md`, `docs/regras.md`, this skill and the card; load pstack `poteto-mode` and
   `typescript-best-practices`; for an adapter, `pricing-adapter`. [conexus-review/SKILL.md:20-24]
2. Read every file of the diff against its unit's section. [:25-26]
3. Try a counterexample to each criterion; run the refusal criteria on a disposable database; for
   the MCP, call each touched tool with a real client, including a refused input. [:27-32]
4. Walk the reference rows: a nativo row uses the named API at the installed version; an embrulhado
   row adds only its line; a changed file no row or contract explains is a Bloqueia. Compare each
   ported piece with the MetalPrice code it came from. [:33-42; references/compare.md:96-111]
5. Label by delivery L12; Bloqueia says who loses what and when. [:45-46]
6. One verdict naming the commit. A delta check reads only `git diff <reviewed>..<new>`. [:50-53]

## What it produces
One comment on the pull request: rules read, reference rows, ran, findings, verdict.
[:57-83, without the vision and sweep sections]
