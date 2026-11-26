import type { PedidoHttp } from '../plataformas/contrato.ts'
import type { ResultadoHttp } from './http.ts'
import { clienteCrawlee } from './http.ts'

export const OPCOES = {
  porMinuto: 6000,
  tentativas: 1,
  prazoPedidoMs: 5000,
  esperaMaximaMs: 60_000,
  tetoBytes: 1_000_000,
  prazoFinal: new Date(Date.now() + 600_000),
}

export function get(url: string): PedidoHttp {
  return { url, metodo: 'GET', cabecalhos: {}, corpo: null }
}

export async function buscar(pedidos: readonly PedidoHttp[], opcoes = OPCOES) {
  const resultados = new Map<number, ResultadoHttp>()
  await clienteCrawlee(opcoes).buscar(pedidos, async (indice, resultado) => {
    resultados.set(indice, resultado)
  })
  return pedidos.map((_, indice) => resultados.get(indice))
}

/** A situação e o status de cada resultado, sem os tempos. */
export function resumo(resultados: readonly (ResultadoHttp | undefined)[]) {
  return resultados.map((r) => {
    if (r === undefined) return 'sem resposta'
    return r.tipo === 'RESPONDEU' ? `RESPONDEU ${r.resposta.status}` : `FALHOU ${r.status}`
  })
}
