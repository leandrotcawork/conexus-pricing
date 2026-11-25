import { saudeDoBanco } from '../banco/leituras.ts'

/** A coleta só está de pé se entrar com a role que escreve. */
export function saudeDaColeta(urlDoBanco: string) {
  return saudeDoBanco(urlDoBanco, 'coletor')
}
