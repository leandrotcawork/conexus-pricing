import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { z } from 'zod'
import type { Banco } from './conexao.ts'

const Nomes = z.array(z.object({ name: z.string() }))

async function nomesAplicados(banco: Banco): Promise<readonly string[]> {
  const existe = await banco.execute(
    sql`SELECT 1 WHERE to_regclass('drizzle.__drizzle_migrations') IS NOT NULL`,
  )
  if (existe.rows.length === 0) return []
  const lidas = await banco.execute(sql`SELECT name FROM drizzle.__drizzle_migrations ORDER BY id`)
  return Nomes.parse(lidas.rows).map((linha) => linha.name)
}

/** Aplica o que falta, numa transação, e devolve os nomes aplicados agora. */
export async function migrarBanco(banco: Banco, pasta: string): Promise<readonly string[]> {
  const antes = new Set(await nomesAplicados(banco))
  await migrate(banco, { migrationsFolder: pasta })
  const depois = await nomesAplicados(banco)
  return depois.filter((nome) => !antes.has(nome))
}
