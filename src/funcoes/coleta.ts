import { z } from 'zod'
import { criarColetor } from '../coleta/coletor.ts'
import type { ResultadoRodada } from '../coleta/executar.ts'
import type { ClienteHttp } from '../coleta/http.ts'
import { configDaColeta } from '../config.ts'
import { naoEncontrado, respostaDeSaude } from './saude.ts'

/** O que o gatilho agendado do Neon envia; `scheduled_at` se repete quando ele reentrega. */
const EnvelopeAgendado = z.object({
  version: z.literal(1),
  invocation_id: z.string().min(1),
  trigger: z.object({ type: z.literal('schedule'), id: z.string(), name: z.string() }),
  data: z.object({ scheduled_at: z.iso.datetime({ offset: true }) }),
})

/** O maior intervalo que o Neon aceita num `Retry-After`. */
const REENTREGAR_EM_SEGUNDOS = '900'

/** 2xx encerra a entrega; 503 pede outra mais tarde. */
function responder(resultado: ResultadoRodada): Response {
  switch (resultado.tipo) {
    case 'FECHADA':
    case 'JA_CONCLUIDA':
    case 'FONTE_INATIVA':
      return Response.json(resultado)
    case 'EM_ANDAMENTO':
    case 'INTERROMPIDA':
      return Response.json(resultado, {
        status: 503,
        headers: { 'retry-after': REENTREGAR_EM_SEGUNDOS },
      })
    case 'FONTE_DESCONHECIDA':
      return Response.json(resultado, { status: 404 })
    case 'CONFIG_INVALIDA':
      return Response.json(resultado, { status: 500 })
    default:
      return resultado satisfies never
  }
}

export function criarFuncaoColeta(
  config: ReturnType<typeof configDaColeta>,
  criarHttp?: () => ClienteHttp,
) {
  const coletor = criarColetor(config.urlDoBanco, criarHttp)

  async function rodar(pedido: Request, codigo: string): Promise<Response> {
    // a URL é pública, mas o Neon apaga os cabeçalhos X-Neon-* de quem vem de fora
    if (!pedido.headers.get('x-neon-trigger-invocation-id')) {
      return Response.json({ erro: 'só o gatilho do Neon roda a coleta' }, { status: 401 })
    }
    const envelope = EnvelopeAgendado.safeParse(await pedido.json().catch(() => null))
    if (!envelope.success) {
      return Response.json({ erro: 'envelope de agendamento inválido' }, { status: 400 })
    }
    const agendadaPara = new Date(envelope.data.data.scheduled_at)
    return responder(await coletor.rodar({ codigo, agendadaPara }))
  }

  return {
    async fetch(pedido: Request): Promise<Response> {
      const { pathname } = new URL(pedido.url)
      if (pedido.method === 'GET' && pathname === '/') {
        return respostaDeSaude(await coletor.saude())
      }
      if (pedido.method !== 'POST' || pathname === '/') return naoEncontrado()
      return await rodar(pedido, pathname.slice(1))
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
