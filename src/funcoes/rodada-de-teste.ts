/** A função da coleta montada contra uma loja em loopback, e a entrega que o gatilho faz a ela. */
import { z } from 'zod'
import { abrirLojaDeTeste, clienteNaLojaDeTeste, comGravacao } from '../coleta/loja-de-teste.ts'
import { criarFuncaoColeta } from './coleta.ts'

export const HOJE = '2026-11-30T06:00:00Z'

const Corpo = z.looseObject({ tipo: z.string().optional(), situacao: z.string().optional() })

export type Roteiro = Parameters<typeof abrirLojaDeTeste>[0]

export function entrega(codigo: string, agendadaPara: string, cabecalhos?: Record<string, string>) {
  return new Request(`https://funcao.teste/${codigo}`, {
    method: 'POST',
    headers: cabecalhos ?? { 'x-neon-trigger-invocation-id': 'entrega-1' },
    body: JSON.stringify({
      version: 1,
      invocation_id: 'entrega-1',
      trigger: { type: 'schedule', id: 'gatilho-1', name: codigo },
      data: { scheduled_at: agendadaPara },
      previous_attempts: [],
      previous_attempts_omitted: 0,
    }),
  })
}

/** Corta toda resposta pedida à VTEX com mais de um EAN. */
export function cortaOLote(...[pedido]: Parameters<Roteiro>) {
  const emLote = pedido.caminho.split('alternateIds_Ean').length > 2
  return comGravacao(pedido, emLote ? 'truncado' : 'lote')
}

/** Uma loja em loopback e a função da coleta apontada para ela. */
export async function montar(
  urlDoBanco: string,
  roteiro: Roteiro = (pedido) => comGravacao(pedido),
  prazoMs?: number,
) {
  const loja = await abrirLojaDeTeste(roteiro)
  const prazo = prazoMs === undefined ? {} : { prazoMs }
  const funcao = criarFuncaoColeta({ urlDoBanco }, () => clienteNaLojaDeTeste(loja.url(''), prazo))
  return {
    loja,
    funcao,
    async disparar(codigo: string, agendadaPara = HOJE) {
      const resposta = await funcao.fetch(entrega(codigo, agendadaPara))
      return {
        status: resposta.status,
        reentregarEm: resposta.headers.get('retry-after'),
        corpo: Corpo.parse(await resposta.json()),
      }
    },
    /** Os EANs de cada pedido de preço que chegou à loja. */
    async eansPedidos() {
      return await Promise.all(
        loja.pedidos.map(async ({ caminho, corpo }) =>
          `${decodeURIComponent(caminho)}${await corpo}`.match(/2000000000\d{3}/g),
        ),
      )
    },
    [Symbol.asyncDispose]: () => loja[Symbol.asyncDispose](),
  }
}
