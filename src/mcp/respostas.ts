import type { z } from 'zod'
import type { Centavos } from '../dominio/marcas.ts'

export type Entrada<F extends { entrada: z.ZodType }> = z.output<F['entrada']>
export type Saida<F extends { saida: z.ZodType }> = z.input<F['saida']>

export type Resposta<S> =
  | { readonly tipo: 'RESPONDIDA'; readonly saida: S }
  | { readonly tipo: 'RECUSADA'; readonly motivo: string }

export const CONTINUACAO_INVALIDA =
  'continuação inválida: o pedido é outro, ou a coleta mudou. Repita sem a continuacao'
export const GRUPO_NAO_ENCONTRADO = 'grupo não encontrado: os códigos estão em grupos_produto'

export function respondida<S>(saida: S): Resposta<S> {
  return { tipo: 'RESPONDIDA', saida }
}

export function recusada<S>(motivo: string): Resposta<S> {
  return { tipo: 'RECUSADA', motivo }
}

export function emReais(centavos: Centavos): number
export function emReais(centavos: Centavos | null): number | null
export function emReais(centavos: Centavos | null): number | null {
  return centavos === null ? null : centavos / 100
}
