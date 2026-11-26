import type { z } from 'zod'
import type { Leituras, LojaAtual, ProdutoRef } from '../banco/leituras.ts'
import type { PrecoColetado } from '../dominio/estatisticas.ts'
import {
  diferencaPct,
  mesmoPrecoDesde,
  resumir,
  SITUACAO_DAS_ESTATISTICAS,
} from '../dominio/estatisticas.ts'
import type { Centavos } from '../dominio/marcas.ts'
import type { Produto } from '../dominio/produto.ts'
import { textoDoAviso } from './avisos.ts'
import { continuacaoDe, lerContinuacao } from './continuacao.ts'
import type { buscarProduto, estatisticasPreco, precosAtuais, saudeColeta } from './ferramentas.ts'

type Entrada<F extends { entrada: z.ZodType }> = z.output<F['entrada']>
type Saida<F extends { saida: z.ZodType }> = z.input<F['saida']>

export type Resposta<S> =
  | { readonly tipo: 'RESPONDIDA'; readonly saida: S }
  | { readonly tipo: 'RECUSADA'; readonly motivo: string }

const TAMANHO_DA_PAGINA = 20
const DIA_MS = 86_400_000
const HORA_MS = 3_600_000

function respondida<S>(saida: S): Resposta<S> {
  return { tipo: 'RESPONDIDA', saida }
}

export function recusada<S>(motivo: string): Resposta<S> {
  return { tipo: 'RECUSADA', motivo }
}

function emReais(centavos: Centavos): number
function emReais(centavos: Centavos | null): number | null
function emReais(centavos: Centavos | null): number | null {
  return centavos === null ? null : centavos / 100
}

export async function responderBusca(
  leituras: Leituras,
  { continuacao, ...busca }: Entrada<typeof buscarProduto>,
): Promise<Resposta<Saida<typeof buscarProduto>>> {
  const depoisDe = continuacao === undefined ? 0 : lerContinuacao(busca, continuacao)
  if (depoisDe === undefined) {
    return recusada('continuação inválida para esta busca: repita a busca sem ela')
  }
  // um a mais diz se há outra página, sem devolver uma vazia no fim
  const lidos = await leituras.buscar({ busca, depoisDe, limite: TAMANHO_DA_PAGINA + 1 })
  const pagina = lidos.slice(0, TAMANHO_DA_PAGINA)
  const ultimo = lidos.length > pagina.length ? pagina.at(-1) : undefined
  return respondida({
    produtos: pagina.map(({ id: _, nossoPreco, ...produto }) => ({
      ...produto,
      nossoPreco: emReais(nossoPreco),
    })),
    continuacao: ultimo ? continuacaoDe(busca, ultimo.id) : null,
  })
}

async function comProduto<S>(
  leituras: Leituras,
  ref: ProdutoRef,
  montar: (produto: Produto) => Promise<S>,
): Promise<Resposta<S>> {
  const achados = await leituras.produtos(ref)
  const [achado] = achados
  if (achado === undefined) return recusada('produto não encontrado')
  if (achados.length > 1) {
    const codigos = achados.map(({ codprod }) => codprod).join(', ')
    return recusada(`mais de um produto tem este EAN (codprod ${codigos}): informe o codprod`)
  }
  return respondida(await montar(achado))
}

function lojaComColeta({ loja, nome, atual }: LojaAtual) {
  if (atual === null) return []
  const { preco, precoLista, coletadoEm, agendadaPara, rodada, ...observada } = atual
  return [
    {
      loja,
      nome,
      ...observada,
      preco: emReais(preco),
      precoLista: emReais(precoLista),
      coletadoEm: coletadoEm.toISOString(),
      rodada: { agendadaPara: agendadaPara.toISOString(), situacao: rodada },
    },
  ]
}

export function responderPrecosAtuais(
  leituras: Leituras,
  { produto: ref }: Entrada<typeof precosAtuais>,
): Promise<Resposta<Saida<typeof precosAtuais>>> {
  return comProduto(leituras, ref, async ({ id, codprod, ean, descricao, nossoPreco }) => {
    const lojas = await leituras.precosAtuais(id)
    return {
      produto: { codprod, ean, descricao, nossoPreco: emReais(nossoPreco) },
      lojas: lojas.flatMap(lojaComColeta),
      lojasSemColeta: lojas.filter(({ atual }) => atual === null).map(({ loja }) => loja),
    }
  })
}

function precoVigente({ atual }: LojaAtual): Centavos | null {
  return atual?.situacao === SITUACAO_DAS_ESTATISTICAS ? atual.preco : null
}

function comportamento(loja: LojaAtual, noPeriodo: readonly PrecoColetado[]) {
  const preco = precoVigente(loja)
  const desde = preco === null ? null : mesmoPrecoDesde(noPeriodo, preco)
  const resumo = resumir(noPeriodo.map((coletado) => coletado.preco))
  return {
    loja: loja.loja,
    situacaoAtual: loja.atual?.situacao ?? null,
    precoAtual: emReais(preco),
    mesmoPrecoDesde: desde?.toISOString() ?? null,
    minimoNoPeriodo: emReais(resumo?.minimo ?? null),
    maximoNoPeriodo: emReais(resumo?.maximo ?? null),
  }
}

function mercado(lojas: readonly LojaAtual[], nossoPreco: Centavos | null) {
  const precos = lojas.map(precoVigente).filter((preco) => preco !== null)
  const resumo = resumir(precos)
  return {
    lojasComPreco: precos.length,
    minimo: emReais(resumo?.minimo ?? null),
    maximo: emReais(resumo?.maximo ?? null),
    media: emReais(resumo?.media ?? null),
    mediana: emReais(resumo?.mediana ?? null),
    nossoPreco: emReais(nossoPreco),
    nossoContraMedianaPct:
      resumo === null || nossoPreco === null ? null : diferencaPct(nossoPreco, resumo.mediana),
  }
}

export function responderEstatisticas(
  leituras: Leituras,
  { produto: ref, dias }: Entrada<typeof estatisticasPreco>,
): Promise<Resposta<Saida<typeof estatisticasPreco>>> {
  return comProduto(leituras, ref, async ({ id, nossoPreco }) => {
    const desde = new Date(Date.now() - dias * DIA_MS)
    const [lojas, historico] = await Promise.all([
      leituras.precosAtuais(id),
      leituras.historico({ produtoId: id, desde }),
    ])
    return {
      atual: mercado(lojas, nossoPreco),
      porLoja: lojas.map((loja) =>
        comportamento(
          loja,
          historico.filter((coletado) => coletado.loja === loja.loja),
        ),
      ),
    }
  })
}

type UltimaRodada = Awaited<ReturnType<Leituras['ultimasRodadas']>>[number]['rodada']

function resumoDaRodada(rodada: NonNullable<UltimaRodada>) {
  const { situacao, agendadaPara, iniciadaEm, concluidaEm, contagens, avisos } = rodada
  const idadeMs = Date.now() - (concluidaEm ?? iniciadaEm).getTime()
  return {
    agendadaPara: agendadaPara.toISOString(),
    situacao,
    iniciadaEm: iniciadaEm.toISOString(),
    concluidaEm: concluidaEm?.toISOString() ?? null,
    contagens,
    avisos: avisos.map(textoDoAviso),
    idadeHoras: Math.round((idadeMs / HORA_MS) * 10) / 10,
  }
}

export async function responderSaude(
  leituras: Leituras,
  { loja }: Entrada<typeof saudeColeta>,
): Promise<Resposta<Saida<typeof saudeColeta>>> {
  const lojas = await leituras.ultimasRodadas(loja)
  if (loja !== undefined && lojas.length === 0) return recusada('loja não encontrada')
  return respondida({
    lojas: lojas.map(({ rodada, ...daLoja }) => ({
      ...daLoja,
      ultimaRodada: rodada && resumoDaRodada(rodada),
    })),
  })
}
