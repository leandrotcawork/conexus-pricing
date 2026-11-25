import { z } from 'zod'

const UrlDoBanco = z.url({ protocol: /^postgres(ql)?$/ })
type Ambiente = Readonly<Record<string, string | undefined>>

const AmbienteDaColeta = z.object({
  COLETOR_DATABASE_URL: UrlDoBanco,
  ALCANCE_TOKEN: z.string().min(32),
})

const AmbienteDoMcp = z.object({ LEITOR_DATABASE_URL: UrlDoBanco })

const AmbienteDaMigracao = z.object({
  DATABASE_URL_UNPOOLED: UrlDoBanco,
  COLETOR_DATABASE_URL: UrlDoBanco,
  LEITOR_DATABASE_URL: UrlDoBanco,
})

const Texto = z.string().min(1)
const Porta = z.coerce.number().int().min(1).max(65535)

const AmbienteDaCarga = z.object({
  SANKHYA_ORACLE_HOST: Texto,
  SANKHYA_ORACLE_PORT: Porta.default(1521),
  SANKHYA_ORACLE_SERVICE_NAME: Texto,
  SANKHYA_ORACLE_USER: Texto,
  SANKHYA_ORACLE_PASSWORD: Texto,
  // entra num ALTER SESSION, que não aceita parâmetro ligado: só um identificador simples
  SANKHYA_ORACLE_SCHEMA: z.string().regex(/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/),
  DATABASE_URL_UNPOOLED: UrlDoBanco,
})

const AmbienteDoOracleDeTeste = z.object({
  TEST_ORACLE_HOST: Texto,
  TEST_ORACLE_PORT: Porta.default(1521),
  TEST_ORACLE_SERVICE_NAME: Texto,
  TEST_ORACLE_SYSTEM_PASSWORD: Texto,
  LD_LIBRARY_PATH: Texto,
})

/** A mensagem leva o nome da variável e o problema, nunca o valor: as URLs carregam senha. */
function ler<T>(esquema: z.ZodType<T>, ambiente: Ambiente): T {
  const lido = esquema.safeParse(ambiente)
  if (!lido.success) throw new Error(`ambiente inválido:\n${z.prettifyError(lido.error)}`)
  return lido.data
}

export function configDaColeta(ambiente: Ambiente = process.env) {
  const lido = ler(AmbienteDaColeta, ambiente)
  return { urlDoBanco: lido.COLETOR_DATABASE_URL, tokenDeAlcance: lido.ALCANCE_TOKEN }
}

export function configDoMcp(ambiente: Ambiente = process.env) {
  return { urlDoBanco: ler(AmbienteDoMcp, ambiente).LEITOR_DATABASE_URL }
}

export function configDaMigracao(ambiente: Ambiente = process.env) {
  const lido = ler(AmbienteDaMigracao, ambiente)
  return {
    urlDoDono: lido.DATABASE_URL_UNPOOLED,
    urlDoColetor: lido.COLETOR_DATABASE_URL,
    urlDoLeitor: lido.LEITOR_DATABASE_URL,
  }
}

export function configDaCarga(ambiente: Ambiente = process.env) {
  const lido = ler(AmbienteDaCarga, ambiente)
  const endereco = `${lido.SANKHYA_ORACLE_HOST}:${lido.SANKHYA_ORACLE_PORT}`
  return {
    oracle: {
      user: lido.SANKHYA_ORACLE_USER,
      password: lido.SANKHYA_ORACLE_PASSWORD,
      connectString: `${endereco}/${lido.SANKHYA_ORACLE_SERVICE_NAME}`,
    },
    esquema: lido.SANKHYA_ORACLE_SCHEMA,
    urlDoDono: lido.DATABASE_URL_UNPOOLED,
  }
}

/** undefined sem `TEST_ORACLE_HOST`: o teste contra o Oracle local é pulado. */
export function oracleDeTeste(ambiente: Ambiente = process.env) {
  if (ambiente.TEST_ORACLE_HOST === undefined) return undefined
  const lido = ler(AmbienteDoOracleDeTeste, ambiente)
  return {
    host: lido.TEST_ORACLE_HOST,
    porta: lido.TEST_ORACLE_PORT,
    servico: lido.TEST_ORACLE_SERVICE_NAME,
    senhaDoSystem: lido.TEST_ORACLE_SYSTEM_PASSWORD,
    // o Oracle Client só é achado por esta variável, e o script do teste roda em outro processo
    bibliotecas: lido.LD_LIBRARY_PATH,
  }
}

/** O que o `neon deploy` sobe para as funções; a falta é recusada pelo próprio deploy. */
export function valoresDaPublicacao(ambiente: Ambiente = process.env) {
  return {
    coletorUrl: ambiente.COLETOR_DATABASE_URL,
    leitorUrl: ambiente.LEITOR_DATABASE_URL,
    tokenDeAlcance: ambiente.ALCANCE_TOKEN,
  }
}

export function urlDoBancoDeTeste(ambiente: Ambiente = process.env): string {
  return ler(z.object({ TEST_DATABASE_URL: UrlDoBanco }), ambiente).TEST_DATABASE_URL
}
