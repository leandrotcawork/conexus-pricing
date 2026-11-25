import { configDoMcp } from '../config.ts'
import { saudeDoMcp } from '../mcp/saude.ts'
import { naoEncontrado, respostaDeSaude } from './saude.ts'

export function criarFuncaoMcp(config: ReturnType<typeof configDoMcp>) {
  const saude = saudeDoMcp(config.urlDoBanco)
  return {
    async fetch(pedido: Request): Promise<Response> {
      const rota = `${pedido.method} ${new URL(pedido.url).pathname}`
      if (rota === 'GET /') return respostaDeSaude(await saude())
      return naoEncontrado()
    },
  }
}

let funcao: ReturnType<typeof criarFuncaoMcp> | undefined

export default {
  // montada no primeiro pedido e reusada: o pool vive no isolate
  fetch(pedido: Request): Promise<Response> {
    funcao ??= criarFuncaoMcp(configDoMcp())
    return funcao.fetch(pedido)
  },
}
