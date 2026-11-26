/** Os indicadores de um conjunto de produtos, e as linhas por produto, grupo, marca ou loja. */
import type { ProdutoNaAnalise } from './analise.ts'
import type { ArvoreDeGrupos } from './grupo.ts'
import type { Cotacao, Posicao } from './indicadores.ts'
import {
  amplitude,
  arredondar,
  emPromocao,
  gapParaOMenor,
  indiceDePreco,
  media,
  mediana,
  mediaPonderada,
  mudancasDePreco,
  paresDePrecos,
  posicaoDe,
  precosDeConcorrente,
  proporcaoPct,
  rupturaPct,
  tendenciaDoIndice,
} from './indicadores.ts'
import type { CodGrupo, FonteCodigo } from './marcas.ts'
import { SEMANAS_PARA_MUDANCAS } from './semanas.ts'

function ouNulo(valor: number | null): number | null {
  return valor === null ? null : arredondar(valor)
}

function semNulos(valores: readonly (number | null)[]): readonly number[] {
  return valores.filter((valor) => valor !== null)
}

/** O índice agregado de cada semana, só das semanas em que algum produto tem índice. */
function serieDoIndice(produtos: readonly ProdutoNaAnalise[]) {
  const semanas = produtos[0]?.janela.map(({ semana }) => semana) ?? []
  return semanas.flatMap((semana, posicao) => {
    const indices = produtos.map(({ nossoPreco, janela }) =>
      indiceDePreco(nossoPreco, precosDeConcorrente(janela[posicao]?.cotacoes ?? [])),
    )
    const indice = media(semNulos(indices))
    return indice === null ? [] : [{ semana, indice }]
  })
}

function comparacao(produtos: readonly ProdutoNaAnalise[]) {
  const lidos = produtos.map(({ nossoPreco, venda12m, atual }) => {
    const precos = precosDeConcorrente(atual)
    return { nossoPreco, precos, peso: venda12m ?? 0, indice: indiceDePreco(nossoPreco, precos) }
  })
  const comIndice = lidos.flatMap(({ indice, peso }) =>
    indice === null ? [] : [{ valor: indice, peso }],
  )
  const posicoes = lidos.map(({ nossoPreco, precos }) => posicaoDe(nossoPreco, precos))
  return {
    cobertura: {
      produtos: produtos.length,
      comPreco: lidos.filter(({ precos }) => precos.length > 0).length,
    },
    indice: ouNulo(media(comIndice.map(({ valor }) => valor))),
    indicePonderado: ouNulo(mediaPonderada(comIndice)),
    gapMenorPct: ouNulo(
      media(semNulos(lidos.map(({ nossoPreco, precos }) => gapParaOMenor(nossoPreco, precos)))),
    ),
    menorPrecoPct: ouNulo(
      proporcaoPct(posicoes.flatMap((p) => (p === null ? [] : [p === 'MAIS_BARATO']))),
    ),
    amplitudePct: ouNulo(mediana(semNulos(lidos.map(({ precos }) => amplitude(precos))))),
  }
}

function historico(produtos: readonly ProdutoNaAnalise[], semanasComColeta: number) {
  const mudancas =
    semanasComColeta < SEMANAS_PARA_MUDANCAS
      ? null
      : mudancasDePreco(produtos.flatMap((p) => paresDePrecos(p.atual, p.anterior)))
  const tendencia = tendenciaDoIndice(serieDoIndice(produtos))
  return {
    mudancas: mudancas && { ...mudancas, tamanhoMedioPct: ouNulo(mudancas.tamanhoMedioPct) },
    tendencia: tendencia && {
      variacaoPct: arredondar(tendencia.variacaoPct),
      inclinacaoPctSemana: arredondar(tendencia.inclinacaoPctSemana),
    },
  }
}

export function indicadoresDe(produtos: readonly ProdutoNaAnalise[], semanasComColeta: number) {
  const atuais = produtos.flatMap(({ atual }) => atual)
  return {
    ...comparacao(produtos),
    emPromocao: emPromocao(atuais),
    rupturaPct: ouNulo(rupturaPct(atuais)),
    ...historico(produtos, semanasComColeta),
  }
}

export const AGRUPAMENTOS = ['produto', 'grupo', 'marca', 'loja'] as const
export type Agrupamento = (typeof AGRUPAMENTOS)[number]
export const ORDENACOES = ['gapMenorPct', 'indice', 'amplitudePct'] as const
export type Ordenacao = (typeof ORDENACOES)[number]

export type PedidoDeLinhas = {
  readonly produtos: readonly ProdutoNaAnalise[]
  readonly lojas: readonly { readonly loja: FonteCodigo; readonly nome: string }[]
  readonly arvore: ArvoreDeGrupos
  readonly semanasComColeta: number
}

function porChave(
  pedido: PedidoDeLinhas,
  rotulo: (produto: ProdutoNaAnalise) => { readonly chave: string; readonly nome: string },
) {
  const grupos = new Map<string, { nome: string; produtos: ProdutoNaAnalise[] }>()
  for (const produto of pedido.produtos) {
    const { chave, nome } = rotulo(produto)
    const grupo = grupos.get(chave) ?? { nome, produtos: [] }
    grupo.produtos.push(produto)
    grupos.set(chave, grupo)
  }
  return [...grupos]
    .toSorted(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(([chave, { nome, produtos }]) => ({
      chave,
      nome,
      posicao: null,
      ...indicadoresDe(produtos, pedido.semanasComColeta),
    }))
}

function rotuloDoGrupo(arvore: ArvoreDeGrupos, grupo: CodGrupo | null) {
  const caminho = grupo === null ? null : arvore.caminho(grupo)
  return caminho === null
    ? { chave: '', nome: 'Sem grupo' }
    : { chave: String(grupo), nome: caminho }
}

function soDaLoja(produto: ProdutoNaAnalise, loja: FonteCodigo): ProdutoNaAnalise {
  function daLoja(cotacoes: readonly Cotacao[]): readonly Cotacao[] {
    return cotacoes.filter((c) => c.loja === loja)
  }
  return {
    ...produto,
    atual: daLoja(produto.atual),
    anterior: daLoja(produto.anterior),
    janela: produto.janela.map((s) => ({ ...s, cotacoes: daLoja(s.cotacoes) })),
  }
}

/** Dos produtos que a loja tem à venda, em quantos % o preço dela é o menor entre as lojas. */
function lojaMaisBarataPct(produtos: readonly ProdutoNaAnalise[], loja: FonteCodigo) {
  return proporcaoPct(
    produtos.flatMap(({ atual }) => {
      const dela = precosDeConcorrente(atual.filter((c) => c.loja === loja))[0]
      return dela === undefined ? [] : [dela <= Math.min(...precosDeConcorrente(atual))]
    }),
  )
}

/** Na linha de uma loja, os indicadores nos comparam só com ela. */
function porLoja(pedido: PedidoDeLinhas) {
  return pedido.lojas.map(({ loja, nome }) => ({
    chave: loja,
    nome,
    posicao: null,
    ...indicadoresDe(
      pedido.produtos.map((produto) => soDaLoja(produto, loja)),
      pedido.semanasComColeta,
    ),
    menorPrecoPct: ouNulo(lojaMaisBarataPct(pedido.produtos, loja)),
  }))
}

function porProduto(pedido: PedidoDeLinhas) {
  return pedido.produtos.map((produto) => ({
    chave: produto.codprod,
    nome: produto.descricao,
    posicao: posicaoDe(produto.nossoPreco, precosDeConcorrente(produto.atual)),
    ...indicadoresDe([produto], pedido.semanasComColeta),
  }))
}

export type LinhaDoPanorama = ReturnType<typeof indicadoresDe> & {
  readonly chave: string
  readonly nome: string
  readonly posicao: Posicao | null
}

/** Na ordem natural: produtos como vieram, grupos e marcas por nome, lojas como vieram. */
export function linhasDoPanorama(
  pedido: PedidoDeLinhas,
  agruparPor: Agrupamento,
): readonly LinhaDoPanorama[] {
  switch (agruparPor) {
    case 'produto':
      return porProduto(pedido)
    case 'grupo':
      return porChave(pedido, ({ grupo }) => rotuloDoGrupo(pedido.arvore, grupo))
    case 'marca':
      return porChave(pedido, ({ marca }) => ({ chave: marca ?? '', nome: marca ?? 'Sem marca' }))
    case 'loja':
      return porLoja(pedido)
    default:
      return agruparPor satisfies never
  }
}

type Ordenavel = { readonly [O in Ordenacao]: number | null }

/** Do maior para o menor; quem não tem base fica no fim, e o empate mantém a ordem natural. */
export function ordenar<L extends Ordenavel>(linhas: readonly L[], por: Ordenacao): readonly L[] {
  function valor(linha: L): number {
    return linha[por] ?? Number.NEGATIVE_INFINITY
  }
  // dois sem base dão NaN, e o sort o trata como empate
  return linhas.toSorted((a, b) => valor(b) - valor(a) || 0)
}
