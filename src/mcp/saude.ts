import { saudeDoBanco } from '../banco/leituras.ts'

/** O MCP só está de pé se entrar com a role que só lê. */
export function saudeDoMcp(urlDoBanco: string) {
  return saudeDoBanco(urlDoBanco, 'leitor')
}
