/** Junta o catálogo com o que as lojas disseram, na forma que os indicadores leem. */
import type { Cotacao } from './indicadores.ts'
import type { ProdutoId, RodadaId } from './marcas.ts'
import type { Produto } from './produto.ts'
import type { serieSemanal } from './semanas.ts'

type DoCatalogo = Pick<Produto, 'codprod' | 'descricao' | 'marca' | 'grupo' | 'nossoPreco'> & {
  /** A venda líquida de 12 meses em centavos, o peso do índice; null antes da carga que a grava. */
  readonly venda12m: number | null
}

export type ProdutoNaAnalise = DoCatalogo & {
  /** A última coleta de cada loja. */
  readonly atual: readonly Cotacao[]
  /** A coleta anterior de cada loja, de outra semana. */
  readonly anterior: readonly Cotacao[]
  /** As semanas que a tendência olha, a mais antiga primeiro. */
  readonly janela: readonly { readonly semana: number; readonly cotacoes: readonly Cotacao[] }[]
}

type Rodada = Parameters<typeof serieSemanal>[0][number] & { readonly id: RodadaId }
type Serie<R extends Rodada> = ReturnType<typeof serieSemanal<R>>

export function rodadasDaAnalise<R extends Rodada>(serie: Serie<R>): readonly R[] {
  const daJanela = serie.janela.flatMap(({ rodadas }) => rodadas)
  const todas = [...serie.atuais, ...serie.anteriores, ...daJanela]
  return [...new Map(todas.map((rodada) => [rodada.id, rodada])).values()]
}

export type CotacaoColetada = {
  readonly rodadaId: RodadaId
  readonly produtoId: ProdutoId
  readonly cotacao: Cotacao
}

export function montarAnalise<R extends Rodada>(
  produtos: readonly (DoCatalogo & { readonly id: ProdutoId })[],
  serie: Serie<R>,
  coletadas: readonly CotacaoColetada[],
): readonly ProdutoNaAnalise[] {
  const doProduto = Map.groupBy(coletadas, ({ produtoId }) => produtoId)
  return produtos.map(({ id, ...produto }) => {
    const porRodada = new Map(doProduto.get(id)?.map((c) => [c.rodadaId, c.cotacao]))
    function nas(rodadas: readonly R[]): readonly Cotacao[] {
      return rodadas.flatMap((rodada) => porRodada.get(rodada.id) ?? [])
    }
    return {
      ...produto,
      atual: nas(serie.atuais),
      anterior: nas(serie.anteriores),
      janela: serie.janela.map(({ semana, rodadas }) => ({ semana, cotacoes: nas(rodadas) })),
    }
  })
}
