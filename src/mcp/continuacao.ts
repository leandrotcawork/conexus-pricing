import { z } from 'zod'
import type { Busca } from '../banco/leituras.ts'
import { ProdutoId } from '../dominio/marcas.ts'

const Marcador = z.tuple([ProdutoId, z.string()])

function assinatura({ texto, ean, codprod, marca }: Busca): string {
  return JSON.stringify([texto, ean, codprod, marca])
}

function comoJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

// a continuação leva a busca junto: usada noutra busca, pularia produtos sem avisar
export function continuacaoDe(busca: Busca, ultimo: ProdutoId): string {
  return Buffer.from(JSON.stringify([ultimo, assinatura(busca)])).toString('base64url')
}

/** O último id já entregue; undefined se a continuação não saiu desta busca. */
export function lerContinuacao(busca: Busca, continuacao: string): ProdutoId | undefined {
  const lido = Marcador.safeParse(comoJson(Buffer.from(continuacao, 'base64url').toString()))
  if (!lido.success) return undefined
  const [ultimo, daBusca] = lido.data
  return daBusca === assinatura(busca) ? ultimo : undefined
}
