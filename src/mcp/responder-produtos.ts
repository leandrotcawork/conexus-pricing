import type { Leituras, ProdutoLido, ProdutoRef, RodadaComPrecos } from '../banco/leituras.ts'
import type { ArvoreDeGrupos } from '../dominio/grupo.ts'
import { arvoreDeGrupos, resumirGrupos } from '../dominio/grupo.ts'
import { arredondar, promocaoDeclarada } from '../dominio/indicadores.ts'
import type { FonteCodigo, ProdutoId } from '../dominio/marcas.ts'
import { serieSemanal } from '../dominio/semanas.ts'
import { LOTE } from './comuns.ts'
import { continuacaoDe, lerContinuacao } from './continuacao.ts'
import type { buscarProdutos, gruposProduto, precosAtuais } from './ferramentas.ts'
import type { Entrada, Resposta, Saida } from './respostas.ts'
import {
  CONTINUACAO_INVALIDA,
  emReais,
  GRUPO_NAO_ENCONTRADO,
  recusada,
  respondida,
} from './respostas.ts'

/**
 * Os produtos na ordem dos pedidos, cada um uma vez, e os pedidos que o catálogo não tem. Um EAN
 * de dois produtos traz os dois.
 */
export async function acharProdutos(leituras: Leituras, refs: readonly ProdutoRef[]) {
  const lidos = await leituras.produtos(refs)
  const achados = new Map<ProdutoId, ProdutoLido>()
  const naoEncontrados = new Set<string>()
  for (const ref of refs) {
    const doPedido = lidos.filter((produto) =>
      'codprod' in ref ? produto.codprod === ref.codprod : produto.ean === ref.ean,
    )
    if (doPedido.length === 0) naoEncontrados.add('codprod' in ref ? ref.codprod : ref.ean)
    for (const produto of doPedido) achados.set(produto.id, produto)
  }
  return { produtos: [...achados.values()], naoEncontrados: [...naoEncontrados] }
}

function produtoDaBusca(lido: ProdutoLido, arvore: ArvoreDeGrupos) {
  const { codprod, ean, descricao, marca, grupo, nossoPreco } = lido
  const caminho = grupo === null ? null : arvore.caminho(grupo)
  return {
    codprod,
    ean,
    descricao,
    marca,
    grupo: grupo === null || caminho === null ? null : { codigo: grupo, caminho },
    nossoPreco: emReais(nossoPreco),
  }
}

export async function responderBusca(
  leituras: Leituras,
  { continuacao, grupo, ...filtros }: Entrada<typeof buscarProdutos>,
): Promise<Resposta<Saida<typeof buscarProdutos>>> {
  const { texto, marca, codprods, eans } = filtros
  const pedido = ['buscar_produtos', texto, marca, grupo, codprods, eans]
  const depoisDe = continuacao === undefined ? 0 : lerContinuacao(pedido, continuacao)
  if (depoisDe === undefined) return recusada(CONTINUACAO_INVALIDA)
  const arvore = arvoreDeGrupos(await leituras.grupos())
  if (grupo !== undefined && !arvore.tem(grupo)) return recusada(GRUPO_NAO_ENCONTRADO)
  const grupos = grupo === undefined ? undefined : [...arvore.comSubgrupos(grupo)]
  // um a mais diz se há outra página, sem devolver uma vazia no fim
  const lidos = await leituras.buscar({
    busca: { ...filtros, grupos },
    depoisDe,
    limite: LOTE + 1,
  })
  const pagina = lidos.slice(0, LOTE)
  const ultimo = lidos.length > pagina.length ? pagina.at(-1) : undefined
  const pedidos = [
    ...(codprods ?? []).map((codprod) => ({ codprod })),
    ...(eans ?? []).map((ean) => ({ ean })),
  ]
  const { naoEncontrados } = await acharProdutos(leituras, pedidos)
  return respondida({
    produtos: pagina.map((lido) => produtoDaBusca(lido, arvore)),
    naoEncontrados,
    continuacao: ultimo ? continuacaoDe(pedido, ultimo.id) : null,
  })
}

export async function responderGrupos(
  leituras: Leituras,
  { dentroDe }: Entrada<typeof gruposProduto>,
): Promise<Resposta<Saida<typeof gruposProduto>>> {
  const arvore = arvoreDeGrupos(await leituras.grupos())
  if (dentroDe !== undefined && !arvore.tem(dentroDe)) return recusada(GRUPO_NAO_ENCONTRADO)
  const { atuais } = serieSemanal(await leituras.rodadasComPrecos())
  const contagens = await leituras.contarPorGrupo(atuais.map(({ id }) => id))
  return respondida({ grupos: resumirGrupos(arvore, { contagens, dentroDe }) })
}

type Observacao = Awaited<ReturnType<Leituras['observacoes']>>[number]

function lojaAtual(loja: FonteCodigo, observada: Observacao, comDetalhes: boolean) {
  const { situacao, preco, precoLista, vendedor, url, detalhe, coletadoEm } = observada
  const promocao = preco === null ? null : promocaoDeclarada(preco, precoLista)
  const detalhes = { vendedor, url, detalhe, coletadoEm: coletadoEm.toISOString() }
  return {
    loja,
    situacao,
    preco: emReais(preco),
    precoLista: emReais(precoLista),
    promocao: promocao === null ? null : arredondar(promocao, 4),
    ...(comDetalhes ? { detalhes } : {}),
  }
}

/** As lojas ativas que têm uma rodada com preços, cada uma com a mais nova. */
async function lojasComRodada(leituras: Leituras) {
  const [lojas, rodadas] = await Promise.all([leituras.lojasAtivas(), leituras.rodadasComPrecos()])
  const atuais = new Map<FonteCodigo, RodadaComPrecos>(
    serieSemanal(rodadas).atuais.map((rodada) => [rodada.loja, rodada]),
  )
  const comRodada = lojas.flatMap((loja) => {
    const rodada = atuais.get(loja.loja)
    return rodada ? [{ ...loja, rodada }] : []
  })
  const semColeta = lojas.filter(({ loja }) => !atuais.has(loja)).map(({ loja }) => loja)
  return { comRodada, semColeta }
}

export async function responderPrecosAtuais(
  leituras: Leituras,
  { produtos: refs, detalhes }: Entrada<typeof precosAtuais>,
): Promise<Resposta<Saida<typeof precosAtuais>>> {
  const [{ produtos, naoEncontrados }, { comRodada, semColeta }] = await Promise.all([
    acharProdutos(leituras, refs),
    lojasComRodada(leituras),
  ])
  const observadas = await leituras.observacoes({
    rodadas: comRodada.map(({ rodada }) => rodada.id),
    produtos: produtos.map(({ id }) => id),
  })
  return respondida({
    rodadas: comRodada.map(({ loja, nome, rodada }) => ({
      loja,
      nome,
      agendadaPara: rodada.agendadaPara.toISOString(),
      situacao: rodada.situacao,
    })),
    lojasSemColeta: semColeta,
    produtos: produtos.map(({ id, codprod, descricao, nossoPreco }) => ({
      codprod,
      descricao,
      nossoPreco: emReais(nossoPreco),
      lojas: comRodada.flatMap(({ loja, rodada }) => {
        const observada = observadas.find((o) => o.rodadaId === rodada.id && o.produtoId === id)
        return observada ? [lojaAtual(loja, observada, detalhes)] : []
      }),
    })),
    naoEncontrados,
  })
}
