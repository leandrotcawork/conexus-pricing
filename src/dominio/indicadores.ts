/**
 * Uma função pura por indicador. Preços em centavos; o que sai em % ou índice vem sem arredondar,
 * para a conta agregada não somar arredondamentos. Só preço `OK` é preço de concorrente.
 */
import type { Centavos, FonteCodigo } from './marcas.ts'
import type { SituacaoObservacao } from './observacao.ts'
import { SEMANAS_PARA_TENDENCIA } from './semanas.ts'

/** O que uma loja disse de um produto numa rodada; só o `OK` carrega preço para a análise. */
export type Cotacao = { readonly loja: FonteCodigo } & (
  | { readonly situacao: 'OK'; readonly preco: Centavos; readonly precoLista: Centavos | null }
  | { readonly situacao: Exclude<SituacaoObservacao, 'OK'> }
)

export type Posicao = 'MAIS_BARATO' | 'NA_FAIXA' | 'MAIS_CARO'

/** Dispersão com menos lojas que isto quase não informa. */
const LOJAS_PARA_AMPLITUDE = 3

export function arredondar(valor: number, casas = 2): number {
  const escala = 10 ** casas
  // `+ 0` troca o -0 por 0
  return Math.round(valor * escala) / escala + 0
}

export function precosDeConcorrente(cotacoes: readonly Cotacao[]): readonly number[] {
  return cotacoes.flatMap((cotacao) => (cotacao.situacao === 'OK' ? [cotacao.preco] : []))
}

/** null sem valor nenhum: não existe resumo de nada. */
export function media(valores: readonly number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((soma, valor) => soma + valor, 0) / valores.length
}

export function mediana(valores: readonly number[]): number | null {
  const ordenados = valores.toSorted((a, b) => a - b)
  // um item no meio quando a quantidade é ímpar, os dois do meio quando é par
  const meio = ordenados.slice(
    Math.floor((ordenados.length - 1) / 2),
    Math.floor(ordenados.length / 2) + 1,
  )
  return media(meio)
}

/** Quem não tem peso positivo não conta; null se ninguém tem. */
export function mediaPonderada(
  itens: readonly { readonly valor: number; readonly peso: number }[],
): number | null {
  const comPeso = itens.filter(({ peso }) => peso > 0)
  const total = comPeso.reduce((soma, { peso }) => soma + peso, 0)
  if (total === 0) return null
  return comPeso.reduce((soma, { valor, peso }) => soma + valor * peso, 0) / total
}

/** Nosso preço ÷ mediana das lojas × 100. */
export function indiceDePreco(nosso: number | null, precos: readonly number[]): number | null {
  const meio = mediana(precos)
  return nosso === null || meio === null ? null : (nosso * 100) / meio
}

/** Quanto estamos acima (positivo) ou abaixo do menor preço, em %. */
export function gapParaOMenor(nosso: number | null, precos: readonly number[]): number | null {
  if (nosso === null || precos.length === 0) return null
  const menor = Math.min(...precos)
  return ((nosso - menor) * 100) / menor
}

/** O empate com o menor conta como o mais barato. */
export function posicaoDe(nosso: number | null, precos: readonly number[]): Posicao | null {
  if (nosso === null || precos.length === 0) return null
  if (nosso <= Math.min(...precos)) return 'MAIS_BARATO'
  return nosso >= Math.max(...precos) ? 'MAIS_CARO' : 'NA_FAIXA'
}

/** (máximo − mínimo) ÷ mínimo entre as lojas, em %. */
export function amplitude(precos: readonly number[]): number | null {
  if (precos.length < LOJAS_PARA_AMPLITUDE) return null
  const menor = Math.min(...precos)
  return ((Math.max(...precos) - menor) * 100) / menor
}

/** 1 − preço ÷ preço de lista: a fração de desconto que a loja declara. */
export function promocaoDeclarada(preco: number, precoLista: number | null): number | null {
  return precoLista === null ? null : 1 - preco / precoLista
}

export function emPromocao(cotacoes: readonly Cotacao[]): number {
  return cotacoes.filter(
    (c) => c.situacao === 'OK' && (promocaoDeclarada(c.preco, c.precoLista) ?? 0) > 0,
  ).length
}

/** % das observações sem estoque. A coleta que falhou (`ERRO`) não conta: não se sabe. */
export function rupturaPct(cotacoes: readonly Cotacao[]): number | null {
  const sabidas = cotacoes.filter(({ situacao }) => situacao !== 'ERRO')
  if (sabidas.length === 0) return null
  const semEstoque = sabidas.filter(({ situacao }) => situacao === 'SEM_ESTOQUE')
  return (semEstoque.length * 100) / sabidas.length
}

/** % de verdadeiros; null sem caso nenhum. */
export function proporcaoPct(casos: readonly boolean[]): number | null {
  const parte = media(casos.map(Number))
  return parte === null ? null : parte * 100
}

export type ParDePrecos = { readonly antes: number; readonly agora: number }

/** O mesmo produto na mesma loja, à venda nas duas rodadas. */
export function paresDePrecos(
  agora: readonly Cotacao[],
  antes: readonly Cotacao[],
): readonly ParDePrecos[] {
  return agora.flatMap((atual) => {
    const anterior = antes.find(({ loja }) => loja === atual.loja)
    if (atual.situacao !== 'OK' || anterior?.situacao !== 'OK') return []
    return [{ antes: anterior.preco, agora: atual.preco }]
  })
}

/** null sem par nenhum para comparar; o tamanho médio é em módulo, só do que mudou. */
export function mudancasDePreco(pares: readonly ParDePrecos[]) {
  if (pares.length === 0) return null
  const mudaram = pares.filter(({ antes, agora }) => antes !== agora)
  return {
    subiram: mudaram.filter(({ antes, agora }) => agora > antes).length,
    desceram: mudaram.filter(({ antes, agora }) => agora < antes).length,
    tamanhoMedioPct: media(
      mudaram.map(({ antes, agora }) => (Math.abs(agora - antes) * 100) / antes),
    ),
  }
}

export type PontoDaSerie = { readonly semana: number; readonly indice: number }

/** A inclinação da reta de mínimos quadrados, em unidades do índice por semana. */
function inclinacao(pontos: readonly PontoDaSerie[], meio: number): number {
  const semanaMedia = media(pontos.map(({ semana }) => semana)) ?? 0
  let cima = 0
  let baixo = 0
  for (const { semana, indice } of pontos) {
    cima += (semana - semanaMedia) * (indice - meio)
    baixo += (semana - semanaMedia) ** 2
  }
  return cima / baixo
}

/**
 * Do índice nas semanas mais novas, a mais antiga primeiro: a média das quatro recentes contra a
 * das quatro anteriores, e a inclinação como % do índice médio por semana. null sem as oito.
 */
export function tendenciaDoIndice(pontos: readonly PontoDaSerie[]) {
  if (pontos.length < SEMANAS_PARA_TENDENCIA) return null
  const usados = pontos.slice(-SEMANAS_PARA_TENDENCIA)
  const indices = usados.map(({ indice }) => indice)
  const metade = SEMANAS_PARA_TENDENCIA / 2
  const antes = media(indices.slice(0, metade))
  const depois = media(indices.slice(metade))
  const meio = media(indices)
  if (antes === null || depois === null || meio === null) return null
  return {
    variacaoPct: ((depois - antes) * 100) / antes,
    inclinacaoPctSemana: (inclinacao(usados, meio) * 100) / meio,
  }
}
