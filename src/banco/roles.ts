import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Banco } from './conexao.ts'

/** Os nomes que a migração das roles cria. */
export const ROLES = { coletor: 'precos_coletor', leitor: 'precos_leitor' } as const
export type Role = (typeof ROLES)[keyof typeof ROLES]

const Comando = z.tuple([z.object({ comando: z.string() })])
const ErroDoPostgres = z.object({ cause: z.object({ code: z.string(), message: z.string() }) })

/** Idempotente: redefine a senha e mantém o login liberado. */
export async function liberarLogin(
  banco: Banco,
  { role, senha }: { readonly role: Role; readonly senha: string },
): Promise<void> {
  try {
    // ALTER ROLE não aceita parâmetro ligado: o servidor monta o comando e cita o valor
    const montado = await banco.execute(
      sql`SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}::text, ${senha}::text) AS comando`,
    )
    const [{ comando }] = Comando.parse(montado.rows)
    await banco.execute(sql.raw(comando))
  } catch (erro) {
    // o erro do Drizzle repete o comando e os parâmetros, que levam a senha: não vai adiante
    const lido = ErroDoPostgres.safeParse(erro)
    const motivo = lido.success
      ? `${lido.data.cause.code} ${lido.data.cause.message.replaceAll(senha, '***')}`
      : 'sem resposta do Postgres'
    throw new Error(`não consegui definir a senha da role ${role}: ${motivo}`)
  }
}
