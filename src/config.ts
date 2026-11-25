import { z } from 'zod'

const UrlDoBanco = z.url({ protocol: /^postgres(ql)?$/ })
type Ambiente = Readonly<Record<string, string | undefined>>

const AmbienteDaMigracao = z.object({
  DATABASE_URL_UNPOOLED: UrlDoBanco,
  COLETOR_DATABASE_URL: UrlDoBanco,
  LEITOR_DATABASE_URL: UrlDoBanco,
})

/** A mensagem leva o nome da variável e o problema, nunca o valor: as URLs carregam senha. */
function ler<T>(esquema: z.ZodType<T>, ambiente: Ambiente): T {
  const lido = esquema.safeParse(ambiente)
  if (!lido.success) throw new Error(`ambiente inválido:\n${z.prettifyError(lido.error)}`)
  return lido.data
}

export function configDaMigracao(ambiente: Ambiente = process.env) {
  const lido = ler(AmbienteDaMigracao, ambiente)
  return {
    urlDoDono: lido.DATABASE_URL_UNPOOLED,
    urlDoColetor: lido.COLETOR_DATABASE_URL,
    urlDoLeitor: lido.LEITOR_DATABASE_URL,
  }
}

export function urlDoBancoDeTeste(ambiente: Ambiente = process.env): string {
  return ler(z.object({ TEST_DATABASE_URL: UrlDoBanco }), ambiente).TEST_DATABASE_URL
}
