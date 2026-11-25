---
name: pricing-study
description: "Studies a conexus-pricing step before its card: reads the founder's decisions, writes the
reference table (one row per piece the step adds: what the founder decided, the reference at the
installed version with file:line, how it does the piece, verdict nativo, embrulhado or remendo),
runs the reference or a prototype where a fact is cheap to observe, tests earlier decisions against
the installed versions, and recommends. Use at the start of every step."
---

# Study

## When to use
Every step's start, before `pricing-scope`. [conexus-study/SKILL.md:8-10]

## Steps
1. Write each question as what a person or agent sees, one sentence, with its premise. [:21]
2. Fill the reference table: founder's decisions first (backlog and earlier study reports), then
   the closest references read at the installed version: `node_modules`, the library's own
   templates, MetalPrice for anything it already does. Each cell carries a label: provado, lido,
   documentado, herdado, hipótese, não verificado. [:22-29; references/sources.md:50-55]
3. Run what is cheap to run: a prototype in a scratch folder, a local double, a disposable
   database. A claim about a library's behaviour is proved against the installed version, never
   the project's main branch on GitHub. [:30-34; the Crawlee 3.18.2 lesson of this card, section 2.1]
4. Verdict per row; a remendo row needs its proof. [:35-37]
5. Test each earlier decision the step leans on against its row; a failed premise goes to its
   decider, quoting it. [:38-43]
6. Recommend what you would write from zero (pstack `poteto-mode`). Options only where references
   diverge or the founder owns the call, each with its native how. [:44-46]

## What it produces
A report outside the repository (founder's page in Portuguese, the table, what was not read or
run). [references/report.md:3-6]

## Stop and ask
A product choice, a spend, a credential, or a remendo row with no cheap proof. [:63-68]
