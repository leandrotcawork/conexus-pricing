import { z } from 'zod'

export const Ean = z
  .string()
  .regex(/^[0-9]{8,14}$/)
  .brand<'Ean'>()
export type Ean = z.infer<typeof Ean>
export const Codprod = z
  .string()
  .regex(/^[0-9]{1,10}$/)
  .brand<'Codprod'>()
export type Codprod = z.infer<typeof Codprod>
export const FonteCodigo = z
  .string()
  .regex(/^[a-z][a-z0-9]{1,19}$/)
  .brand<'FonteCodigo'>()
export type FonteCodigo = z.infer<typeof FonteCodigo>
export const ProdutoId = z.number().int().positive().brand<'ProdutoId'>()
export type ProdutoId = z.infer<typeof ProdutoId>
export const RodadaId = z.number().int().positive().brand<'RodadaId'>()
export type RodadaId = z.infer<typeof RodadaId>
export const FonteId = z.number().int().positive().brand<'FonteId'>()
export type FonteId = z.infer<typeof FonteId>

/** Dinheiro exato em centavos (data D15). A loja manda reais em ponto flutuante. */
export const Centavos = z.number().int().positive().brand<'Centavos'>()
export type Centavos = z.infer<typeof Centavos>

/** null para zero, negativo ou não finito: "preço zero" é ausência, nunca preço (code C22). */
export function centavosDeReais(reais: number): Centavos | null {
  if (!Number.isFinite(reais) || reais <= 0) return null
  return Centavos.parse(Math.round(reais * 100))
}
