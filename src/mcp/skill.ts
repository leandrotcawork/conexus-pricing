import { readFileSync } from 'node:fs'

// no arquivo que o `neon deploy` sobe não há disco para ler: scripts/empacotar.ts troca este
// módulo pelo texto da skill
export const SKILL_ANALISE_PRECOS = readFileSync(
  new URL('../../skills/analise-precos/SKILL.md', import.meta.url),
  'utf8',
)
