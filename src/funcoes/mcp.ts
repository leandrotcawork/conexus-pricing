import { createHash, timingSafeEqual } from 'node:crypto'
import { configDoMcp } from '../config.ts'
import { criarMcp } from '../mcp/servidor.ts'
import { naoEncontrado } from './saude.ts'

function resumo(texto: string): Buffer {
  return createHash('sha256').update(texto).digest()
}

function naoAutorizado(): Response {
  return Response.json(
    { erro: 'token ausente ou inválido' },
    { status: 401, headers: { 'www-authenticate': 'Bearer' } },
  )
}

export function criarFuncaoMcp(config: ReturnType<typeof configDoMcp>) {
  const mcp = criarMcp(config.urlDoBanco)
  const esperado = resumo(`Bearer ${config.token}`)
  return {
    async fetch(pedido: Request): Promise<Response> {
      if (new URL(pedido.url).pathname !== '/mcp') return naoEncontrado()
      // resumos têm sempre o mesmo tamanho: o tempo não conta quanto do token está certo
      const enviado = resumo(pedido.headers.get('authorization') ?? '')
      if (!timingSafeEqual(enviado, esperado)) return naoAutorizado()
      return await mcp.fetch(pedido)
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
