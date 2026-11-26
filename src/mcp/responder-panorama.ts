import type { Leituras, ProdutoLido } from '../banco/leituras.ts'
import { montarAnalise, rodadasDaAnalise } from '../dominio/analise.ts'
import type { ArvoreDeGrupos } from '../dominio/grupo.ts'
import { arvoreDeGrupos } from '../dominio/grupo.ts'
import { indicadoresDe, linhasDoPanorama, ordenar } from '../dominio/panorama.ts'
import { SEMANAS_PARA_MUDANCAS, SEMANAS_PARA_TENDENCIA, serieSemanal } from '../dominio/semanas.ts'
import { continuacaoDe, lerContinuacao } from './continuacao.ts'
import type { panoramaPrecos } from './ferramentas-de-mercado.ts'
import { acharProdutos } from './responder-produtos.ts'
import type { Entrada, Resposta, Saida } from './respostas.ts'
import { CONTINUACAO_INVALIDA, GRUPO_NAO_ENCONTRADO, recusada, respondida } from './respostas.ts'

type Escopo = Entrada<typeof panoramaPrecos>['escopo']
type DoEscopo = { readonly produtos: readonly ProdutoLido[]; readonly naoEncontrados: string[] }

/** undefined se o grupo pedido não existe. */
async function produtosDoEscopo(
  leituras: Leituras,
  arvore: ArvoreDeGrupos,
  escopo: Escopo,
): Promise<DoEscopo | undefined> {
  if ('produtos' in escopo) return await acharProdutos(leituras, escopo.produtos)
  if ('grupo' in escopo && !arvore.tem(escopo.grupo)) return undefined
  const busca = {
    marcaInteira: 'marca' in escopo ? escopo.marca : undefined,
    grupos: 'grupo' in escopo ? [...arvore.comSubgrupos(escopo.grupo)] : undefined,
  }
  return { produtos: await leituras.buscar({ busca }), naoEncontrados: [] }
}

function semanasQueFaltam(semanas: number): string | null {
  if (semanas >= SEMANAS_PARA_TENDENCIA) return null
  const pede =
    semanas < SEMANAS_PARA_MUDANCAS
      ? `mudanças pedem ${SEMANAS_PARA_MUDANCAS} semanas de coleta e a tendência pede ${SEMANAS_PARA_TENDENCIA}`
      : `a tendência pede ${SEMANAS_PARA_TENDENCIA} semanas de coleta`
  return `ainda não há semanas suficientes: ${pede}; há ${semanas}`
}

async function lerAnalise(leituras: Leituras, escopo: Escopo, doEscopo: DoEscopo) {
  const serie = serieSemanal(await leituras.rodadasComPrecos())
  const rodadas = rodadasDaAnalise(serie)
  const coletadas = await leituras.cotacoes({
    rodadas: rodadas.map(({ id }) => id),
    lojas: new Map(rodadas.map(({ id, loja }) => [id, loja])),
    // o catálogo inteiro não precisa ser listado na consulta
    produtos: 'catalogo' in escopo ? undefined : doEscopo.produtos.map(({ id }) => id),
  })
  return {
    semanasComColeta: serie.semanasComColeta,
    produtos: montarAnalise(doEscopo.produtos, serie, coletadas),
    // uma rodada nova muda as linhas: a continuação de antes deixa de valer
    rodadas: rodadas.map(({ id }) => id).toSorted((a, b) => a - b),
  }
}

export async function responderPanorama(
  leituras: Leituras,
  { escopo, agruparPor, ordenarPor, limite, continuacao }: Entrada<typeof panoramaPrecos>,
): Promise<Resposta<Saida<typeof panoramaPrecos>>> {
  const arvore = arvoreDeGrupos(await leituras.grupos())
  const doEscopo = await produtosDoEscopo(leituras, arvore, escopo)
  if (doEscopo === undefined) return recusada(GRUPO_NAO_ENCONTRADO)
  const { produtos, semanasComColeta, rodadas } = await lerAnalise(leituras, escopo, doEscopo)
  const pedido = ['panorama_precos', escopo, agruparPor, ordenarPor, rodadas]
  const inicio = continuacao === undefined ? 0 : lerContinuacao(pedido, continuacao)
  if (inicio === undefined) return recusada(CONTINUACAO_INVALIDA)
  const lojas = await leituras.lojasAtivas()
  const linhas = linhasDoPanorama({ produtos, lojas, arvore, semanasComColeta }, agruparPor)
  const ordenadas = ordenarPor === undefined ? linhas : ordenar(linhas, ordenarPor)
  const fim = inicio + limite
  return respondida({
    semanasComColeta,
    historico: semanasQueFaltam(semanasComColeta),
    total: indicadoresDe(produtos, semanasComColeta),
    linhas: ordenadas.slice(inicio, fim),
    naoEncontrados: doEscopo.naoEncontrados,
    continuacao: fim < ordenadas.length ? continuacaoDe(pedido, fim) : null,
  })
}
