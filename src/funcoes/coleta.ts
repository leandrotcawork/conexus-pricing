import { createHash, timingSafeEqual } from 'node:crypto'
import type { Alvos } from '../coleta/alcance.ts'
import { alcancarLojas, PedidoDeAlcance } from '../coleta/alcance.ts'
import { saudeDaColeta } from '../coleta/saude.ts'
import { configDaColeta } from '../config.ts'
import { naoEncontrado, respostaDeSaude } from './saude.ts'

function resumo(texto: string): Buffer {
  return createHash('sha256').update(texto).digest()
}

/** Comparação em tempo constante: a URL da função é pública. */
function autorizado(pedido: Request, token: string): boolean {
  const recebido = pedido.headers.get('authorization') ?? ''
  return timingSafeEqual(resumo(recebido), resumo(`Bearer ${token}`))
}

async function responderAlcance(pedido: Request, alvos: Alvos | undefined): Promise<Response> {
  const corpo: unknown = await pedido.json().catch(() => null)
  const lido = PedidoDeAlcance.safeParse(corpo)
  if (!lido.success) {
    return Response.json({ erro: 'corpo precisa de ean e tokenAbc' }, { status: 400 })
  }
  return Response.json({ lojas: await alcancarLojas(lido.data, alvos) })
}

/** `alvos` troca os endereços das lojas, para o teste responder no lugar delas. */
export function criarFuncaoColeta(config: ReturnType<typeof configDaColeta>, alvos?: Alvos) {
  const saude = saudeDaColeta(config.urlDoBanco)
  return {
    async fetch(pedido: Request): Promise<Response> {
      const rota = `${pedido.method} ${new URL(pedido.url).pathname}`
      if (rota === 'GET /') return respostaDeSaude(await saude())
      // o `_` impede colisão com o código de uma loja
      if (rota !== 'POST /_alcance') return naoEncontrado()
      if (!autorizado(pedido, config.tokenDeAlcance)) {
        return Response.json({ erro: 'token ausente ou errado' }, { status: 401 })
      }
      return await responderAlcance(pedido, alvos)
    },
  }
}

let funcao: ReturnType<typeof criarFuncaoColeta> | undefined

export default {
  // montada no primeiro pedido e reusada: o pool vive no isolate
  fetch(pedido: Request): Promise<Response> {
    funcao ??= criarFuncaoColeta(configDaColeta())
    return funcao.fetch(pedido)
  },
}
