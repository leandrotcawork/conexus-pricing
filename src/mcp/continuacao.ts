import { createHash } from 'node:crypto'
import { z } from 'zod'

const Marcador = z.tuple([z.number().int().nonnegative(), z.string()])

function assinatura(pedido: unknown): string {
  return createHash('sha256').update(JSON.stringify(pedido)).digest('base64url')
}

function comoJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

// a continuação leva o pedido junto: usada noutro, pularia linhas sem avisar
export function continuacaoDe(pedido: unknown, posicao: number): string {
  return Buffer.from(JSON.stringify([posicao, assinatura(pedido)])).toString('base64url')
}

/** Onde a página anterior parou; undefined se a continuação não saiu deste pedido. */
export function lerContinuacao(pedido: unknown, continuacao: string): number | undefined {
  const lido = Marcador.safeParse(comoJson(Buffer.from(continuacao, 'base64url').toString()))
  if (!lido.success) return undefined
  const [posicao, dado] = lido.data
  return dado === assinatura(pedido) ? posicao : undefined
}
