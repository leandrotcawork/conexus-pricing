import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { PLATAFORMAS } from '../src/dominio/fonte.ts'
import { FonteCodigo } from '../src/dominio/marcas.ts'

const MIGRACOES = join(import.meta.dirname, '../migrations')
/** Uma linha de `INSERT INTO precos.fonte`: código, nome, plataforma e a config em JSON. */
const LINHA = /\('([^']+)',\s*'(?:[^']|'')+',\s*'([^']+)',\s*'(\{[^']*\})'\)/g

const FonteSemeada = z.object({
  codigo: FonteCodigo,
  plataforma: z.enum(PLATAFORMAS),
  config: z.json(),
})
type FonteSemeada = z.infer<typeof FonteSemeada>

/**
 * As lojas como as migrações as criam, para rodar uma sem banco. Um `UPDATE` posterior não entra:
 * o `tokenReserva` é gravado à mão no banco e fica de fora.
 */
export function fontesDasMigracoes(): readonly FonteSemeada[] {
  return readdirSync(MIGRACOES)
    .sort()
    .flatMap((pasta) => {
      const sql = readFileSync(join(MIGRACOES, pasta, 'migration.sql'), 'utf8')
      return [...sql.matchAll(LINHA)].map(([, codigo, plataforma, config = '']) =>
        FonteSemeada.parse({ codigo, plataforma, config: JSON.parse(config) }),
      )
    })
}

export function fonteDasMigracoes(codigo: string): FonteSemeada {
  const fontes = fontesDasMigracoes()
  const fonte = fontes.find((semeada) => semeada.codigo === codigo)
  if (fonte) return fonte
  const conhecidas = fontes.map((semeada) => semeada.codigo).join(', ')
  throw new Error(`loja desconhecida; as das migrações são: ${conhecidas}`)
}
