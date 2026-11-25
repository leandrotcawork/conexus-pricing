import type { Centavos } from './marcas.ts'

/** O que uma loja publica para um EAN. Uma loja pode ter vários cadastros do mesmo EAN (tray.py:3-13). */
export type Oferta = {
  readonly preco: Centavos | null
  readonly precoLista: Centavos | null
  readonly disponivel: boolean
  readonly vendedor: string | null
  readonly url: string | null
}

export type Observacao =
  | {
      readonly situacao: 'OK'
      readonly preco: Centavos
      readonly precoLista: Centavos | null
      readonly vendedor: string | null
      readonly url: string | null
      readonly cadastros: number
    }
  | {
      readonly situacao: 'SEM_ESTOQUE'
      readonly preco: Centavos
      readonly vendedor: string | null
      readonly url: string | null
      readonly cadastros: number
    }
  | { readonly situacao: 'SEM_PRECO'; readonly url: string | null }
  | { readonly situacao: 'NAO_ENCONTRADO' }
  | { readonly situacao: 'ERRO'; readonly detalhe: string }

/** A união em valor, para o enum do banco; tipos.check.ts prova que não divergem. */
export const SITUACOES_OBSERVACAO = [
  'OK',
  'SEM_ESTOQUE',
  'SEM_PRECO',
  'NAO_ENCONTRADO',
  'ERRO',
] as const

export type SituacaoObservacao = (typeof SITUACOES_OBSERVACAO)[number]

type OfertaComPreco = Oferta & { readonly preco: Centavos }

function temPreco(oferta: Oferta): oferta is OfertaComPreco {
  return oferta.preco !== null
}

function maisBarata(ofertas: readonly OfertaComPreco[]): OfertaComPreco | undefined {
  return ofertas.reduce<OfertaComPreco | undefined>(
    (melhor, oferta) => (melhor === undefined || oferta.preco < melhor.preco ? oferta : melhor),
    undefined,
  )
}

/**
 * A regra única do MetalPrice (vtex.py:98-114, tray.py:117-133, wake.py:131-142):
 * nenhuma oferta, NAO_ENCONTRADO; nenhuma com preço, SEM_PRECO; nenhuma disponível,
 * SEM_ESTOQUE com a mais barata; senão OK com a mais barata disponível.
 */
export function decidir(ofertas: readonly Oferta[] | undefined): Observacao {
  const primeira = ofertas?.[0]
  if (ofertas === undefined || primeira === undefined) return { situacao: 'NAO_ENCONTRADO' }
  const comPreco = ofertas.filter(temPreco)
  const cadastros = ofertas.length
  const disponivel = maisBarata(comPreco.filter((oferta) => oferta.disponivel))
  if (disponivel !== undefined) {
    const { preco, precoLista, vendedor, url } = disponivel
    return { situacao: 'OK', preco, precoLista, vendedor, url, cadastros }
  }
  const indisponivel = maisBarata(comPreco)
  if (indisponivel === undefined) return { situacao: 'SEM_PRECO', url: primeira.url }
  const { preco, vendedor, url } = indisponivel
  return { situacao: 'SEM_ESTOQUE', preco, vendedor, url, cadastros }
}
