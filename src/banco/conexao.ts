import { attachDatabasePool } from '@neon/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export type Banco = ReturnType<typeof abrirBanco>

/** Um Pool por URL, aberto no escopo do módulo da função e reusado entre requisições. */
export function abrirBanco(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 5,
    // curto para não segurar o compute do Neon acordado (data D27)
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  })
  attachDatabasePool(pool)
  return drizzle({ client: pool })
}

export async function fecharBanco(banco: Banco): Promise<void> {
  await banco.$client.end()
}
