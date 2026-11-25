import { fileURLToPath } from 'node:url'
import { abrirBanco, fecharBanco } from '../src/banco/conexao.ts'
import { migrarBanco } from '../src/banco/migracao.ts'
import type { Role } from '../src/banco/roles.ts'
import { liberarLogin, ROLES } from '../src/banco/roles.ts'
import { configDaMigracao } from '../src/config.ts'

const PASTA = fileURLToPath(new URL('../migrations', import.meta.url))

/** A senha de cada role é a que está na URL que a função vai usar: um segredo só, sem divergir. */
function senhaDaUrl(url: string, role: Role): string {
  const { username, password } = new URL(url)
  if (username !== role || password === '') {
    throw new Error(`a URL da role ${role} precisa ter o usuário ${role} e uma senha`)
  }
  return decodeURIComponent(password)
}

async function migrar(): Promise<void> {
  const config = configDaMigracao()
  // as duas URLs são conferidas antes de tocar o banco
  const credenciais = [
    { role: ROLES.coletor, senha: senhaDaUrl(config.urlDoColetor, ROLES.coletor) },
    { role: ROLES.leitor, senha: senhaDaUrl(config.urlDoLeitor, ROLES.leitor) },
  ]
  const banco = abrirBanco(config.urlDoDono)
  try {
    const aplicadas = await migrarBanco(banco, PASTA)
    console.log(`migrações aplicadas: ${aplicadas.length} ${aplicadas.join(' ')}`.trim())
    for (const credencial of credenciais) await liberarLogin(banco, credencial)
    console.log(`senhas definidas: ${credenciais.map(({ role }) => role).join(' ')}`)
  } finally {
    await fecharBanco(banco)
  }
}

await migrar()
