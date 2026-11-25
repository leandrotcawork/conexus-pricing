import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { sql } from 'drizzle-orm'
import { abrirBanco, fecharBanco } from './conexao.ts'
import type { Role } from './roles.ts'
import { ROLES } from './roles.ts'

const MIGRAR = fileURLToPath(new URL('../../scripts/migrar.ts', import.meta.url))
// uma senha só para todas as suítes: roles valem para o cluster inteiro e suítes rodam em paralelo
const SENHA_DE_TESTE = 'Precos_teste-7Qk2mZ9x'
const executar = promisify(execFile)

function urlDeOutroBanco(urlBase: string, banco: string, role?: Role): string {
  const url = new URL(urlBase)
  url.pathname = `/${banco}`
  if (role !== undefined) {
    url.username = role
    url.password = SENHA_DE_TESTE
  }
  return url.href
}

/** Um banco vazio no PostgreSQL de teste, migrado só por `scripts/migrar.ts` (testing T19). */
export async function criarBancoDescartavel(urlBase: string) {
  const nome = `precos_teste_${randomUUID().replaceAll('-', '')}`
  const base = abrirBanco(urlBase)
  await base.execute(sql`CREATE DATABASE ${sql.identifier(nome)}`)
  const urls = {
    dono: urlDeOutroBanco(urlBase, nome),
    coletor: urlDeOutroBanco(urlBase, nome, ROLES.coletor),
    leitor: urlDeOutroBanco(urlBase, nome, ROLES.leitor),
  }
  return {
    urls,
    /** Roda o script e devolve o que ele escreveu. Um de cada vez: ALTER ROLE não é concorrente. */
    async migrar(): Promise<string> {
      return await base.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('precos-teste-migrar'))`)
        const env = {
          DATABASE_URL_UNPOOLED: urls.dono,
          COLETOR_DATABASE_URL: urls.coletor,
          LEITOR_DATABASE_URL: urls.leitor,
        }
        const { stdout } = await executar(process.execPath, [MIGRAR], { env })
        return stdout
      })
    },
    async apagar(): Promise<void> {
      await base.execute(sql`DROP DATABASE ${sql.identifier(nome)} WITH (FORCE)`)
      await fecharBanco(base)
    },
  }
}
