import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Banco } from './conexao.ts'
import { abrirBanco } from './conexao.ts'
import { ROLES } from './roles.ts'

type EstadoDoBanco =
  | { readonly dePe: true; readonly role: string }
  | { readonly dePe: false; readonly motivo: 'ROLE_ERRADA' | 'BANCO_INACESSIVEL' }

const Sessao = z.tuple([z.object({ um: z.literal(1), role: z.string() })])

/** Abre o pool uma vez; cada chamada faz um SELECT 1 e confere com que role entrou. */
export function saudeDoBanco(url: string, papel: keyof typeof ROLES) {
  return saudeDe(abrirBanco(url), papel)
}

export function saudeDe(banco: Banco, papel: keyof typeof ROLES) {
  const esperada = ROLES[papel]
  return async function conferir(): Promise<EstadoDoBanco> {
    try {
      const lido = await banco.execute(sql`SELECT 1 AS um, current_user AS role`)
      const [{ role }] = Sessao.parse(lido.rows)
      if (role === esperada) return { dePe: true, role }
      console.error(`o banco respondeu à role ${role}; a função exige ${esperada}`)
      return { dePe: false, motivo: 'ROLE_ERRADA' }
    } catch (erro) {
      // o motivo fica no log: a resposta é pública
      console.error('o banco não respondeu:', erro)
      return { dePe: false, motivo: 'BANCO_INACESSIVEL' }
    }
  }
}
