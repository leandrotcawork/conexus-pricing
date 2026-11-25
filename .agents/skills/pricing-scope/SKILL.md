---
name: pricing-scope
description: "Writes the card of a conexus-pricing step from its study: the founder's page in
Portuguese with what he will see at the end and only his real decisions, the use script, the units
grouped into one pull request, acceptance criteria observable from outside, the failure table for
every write, and each unit's build spec with files, reference lines, shapes and tests. Also answers
'quero entender a etapa X' from the card's founder's page. Use after the study and before any build."
---

# Scope

## Steps
1. Write the sentence of use and the use script: three to six actions as the founder or an agent
   sees them (an MCP call, `saude_coleta`, a script run with `!`). [conexus-scope/SKILL.md:21-23]
2. List what enters and stays out, with why; estimate changed lines; past about 1,500, split.
   [:24-25; delivery L2, scaled]
3. Acceptance criteria, each observable from outside, refusals included. Failure table: for every
   write (rodada claim, observation upsert, catalog load) the row for twice at once, refused midway
   and a dependency down. [:26-29; references/card.md:58-61]
4. Design from zero (pstack `poteto-mode`, `architect` for a contract that crosses modules). Units
   that each end green, one commit each, one pull request for the step. [:30-38]
5. Each unit's section is its build spec: files, reference `file:line`, shapes (unions, brands, Zod
   schemas), tests, hand mutations, "done when". The builder reads only its section.
   [:49-53; references/card.md:80-134]
6. The founder's page last, in Portuguese: what he will do at the end, his decisions lettered with a
   recommendation and the native how in one line. It doubles as the explanation page when he asks
   to understand the step. [:46-48; conexus-explain/references/outline.md:1-8]

## Template
The light card of Conexus (`conexus-scope/references/pattern-card.md:94-119`) plus the failure table and
the per-unit spec. At most 2,000 words outside the founder's page.

## When it closes
The founder approves the page; firstmate records his words and date.
