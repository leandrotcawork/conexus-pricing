import type { Banco } from '../banco/conexao.ts'
import type { Observado, ProdutoPendente } from '../banco/rodadas.ts'
import {
  contar,
  fecharRodada,
  lerFonte,
  okDaUltimaConcluida,
  produtosPendentes,
  registrar,
  tomarRodada,
} from '../banco/rodadas.ts'
import type { Fonte } from '../dominio/fonte.ts'
import type { Ean, FonteCodigo, ProdutoId, RodadaId } from '../dominio/marcas.ts'
import type { Observacao } from '../dominio/observacao.ts'
import { decidir } from '../dominio/observacao.ts'
import type { Aviso, Contagens } from '../dominio/rodada.ts'
import { classificar } from '../dominio/rodada.ts'
import type { LeituraLote, Lotes, PlanoDeColeta } from '../plataformas/contrato.ts'
import { ADAPTADORES } from '../plataformas/registro.ts'
import type { ClienteHttp, ResultadoHttp } from './http.ts'

export type ResultadoRodada =
  | {
      readonly tipo: 'FECHADA'
      readonly rodadaId: RodadaId
      readonly situacao: 'CONCLUIDA' | 'SUSPEITA'
      readonly contagens: Contagens
      readonly avisos: readonly Aviso[]
    }
  | { readonly tipo: 'JA_CONCLUIDA'; readonly rodadaId: RodadaId }
  | { readonly tipo: 'EM_ANDAMENTO'; readonly rodadaId: RodadaId }
  | { readonly tipo: 'INTERROMPIDA'; readonly rodadaId: RodadaId }
  | { readonly tipo: 'FONTE_INATIVA' }
  | { readonly tipo: 'FONTE_DESCONHECIDA' }
  | { readonly tipo: 'CONFIG_INVALIDA'; readonly rodadaId: RodadaId; readonly motivo: string }

type Dependencias = { readonly banco: Banco; readonly http: ClienteHttp }

type Pedido = {
  readonly fonte: FonteCodigo
  readonly agendadaPara: Date
  readonly versao: string
}

type Rodada = Dependencias & { readonly rodadaId: RodadaId }

type PorEan = ReadonlyMap<Ean, readonly ProdutoId[]>

function agruparPorEan(produtos: readonly ProdutoPendente[]): PorEan {
  const grupos = new Map<Ean, ProdutoId[]>()
  for (const { ean, id } of produtos) {
    const grupo = grupos.get(ean)
    if (grupo) grupo.push(id)
    else grupos.set(ean, [id])
  }
  return grupos
}

function emLotes<Item>(itens: readonly Item[], tamanho: number): readonly (readonly Item[])[] {
  const quantos = Math.ceil(itens.length / tamanho)
  return Array.from({ length: quantos }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho))
}

function observados(
  grupos: PorEan,
  eans: readonly Ean[],
  observar: (ean: Ean) => Observacao,
): readonly Observado[] {
  return eans.flatMap((ean) => {
    const observacao = observar(ean)
    return (grupos.get(ean) ?? []).map((produtoId) => ({ produtoId, observacao }))
  })
}

function interpretar(lotes: Lotes, resultado: ResultadoHttp, eans: readonly Ean[]): LeituraLote {
  if (resultado.tipo === 'FALHOU') return { tipo: 'INVALIDO', motivo: resultado.detalhe }
  return lotes.ler(resultado.resposta, eans)
}

type Passada = {
  readonly lotes: Lotes
  readonly grupos: PorEan
  readonly pedacos: readonly (readonly Ean[])[]
  readonly recusado: (
    eans: readonly Ean[],
    motivo: string,
  ) => { readonly observados: readonly Observado[]; readonly avisos: readonly Aviso[] }
}

async function perguntar(rodada: Rodada, passada: Passada): Promise<void> {
  const { lotes, grupos, pedacos, recusado } = passada
  if (pedacos.length === 0) return
  await rodada.http.buscar(
    pedacos.map((eans) => lotes.pedido(eans)),
    async (indice, resultado) => {
      const eans = pedacos[indice] ?? []
      const leitura = interpretar(lotes, resultado, eans)
      const gravar =
        leitura.tipo === 'LIDO'
          ? {
              observados: observados(grupos, eans, (ean) => decidir(leitura.ofertas.get(ean))),
              avisos: [],
            }
          : recusado(eans, leitura.motivo)
      await registrar(rodada.banco, { rodadaId: rodada.rodadaId, ...gravar })
    },
  )
}

type Bloco = {
  readonly lotes: Lotes
  readonly grupos: PorEan
  readonly eans: readonly Ean[]
}

/**
 * Primeiro em lotes. O que um lote recusado não respondeu é perguntado um a um, com aviso
 * (vtex.py:76-84,95-97); o EAN que falha também assim vira ERRO com o motivo.
 */
async function coletarBloco(rodada: Rodada, { lotes, grupos, eans }: Bloco): Promise<void> {
  const umAUm: Ean[] = []
  await perguntar(rodada, {
    lotes,
    grupos,
    pedacos: emLotes(eans, lotes.maximo),
    recusado(recusados, motivo) {
      umAUm.push(...recusados)
      const aviso = { tipo: 'LOTE_REFEITO_UM_A_UM', eans: recusados.length, motivo } as const
      return { observados: [], avisos: [aviso] }
    },
  })
  await perguntar(rodada, {
    lotes,
    grupos,
    pedacos: emLotes(umAUm, 1),
    recusado: (recusados, detalhe) => ({
      observados: observados(grupos, recusados, () => ({ situacao: 'ERRO', detalhe })),
      avisos: [],
    }),
  })
}

/**
 * Um bloco por vez (pesquisa.py:17-19,137-148): se todos os lotes viessem antes do primeiro um a
 * um, lotes que só falham devagar gastariam o prazo de cada entrega sem gravar nada.
 */
const EANS_POR_BLOCO = 150

async function coletar(rodada: Rodada, lotes: Lotes): Promise<void> {
  const grupos = agruparPorEan(await produtosPendentes(rodada.banco, rodada.rodadaId))
  for (const eans of emLotes([...grupos.keys()], EANS_POR_BLOCO)) {
    await coletarBloco(rodada, { lotes, grupos, eans })
  }
}

async function preparar(rodada: Rodada, plano: PlanoDeColeta): Promise<Lotes | null> {
  if (plano.tipo === 'DIRETO') return plano.lotes
  let lotes: Lotes | null = null
  await rodada.http.buscar([plano.preparo], async (_, resultado) => {
    const resposta = resultado.tipo === 'RESPONDEU' ? resultado.resposta : null
    const preparado = plano.lerPreparo(resposta)
    lotes = preparado.lotes
    await registrar(rodada.banco, {
      rodadaId: rodada.rodadaId,
      observados: [],
      avisos: preparado.avisos,
    })
  })
  return lotes
}

async function fechar(rodada: Rodada, fonte: Fonte, agendadaPara: Date): Promise<ResultadoRodada> {
  const { banco, rodadaId } = rodada
  const faltaram = (await produtosPendentes(banco, rodadaId)).length
  const contagens = await contar(banco, rodadaId)
  if (faltaram > 0) {
    const avisos = [{ tipo: 'PRAZO_ESGOTADO', faltaram }] as const
    await fecharRodada(banco, { rodadaId, situacao: 'INTERROMPIDA', contagens, avisos })
    return { tipo: 'INTERROMPIDA', rodadaId }
  }
  const okAnterior = await okDaUltimaConcluida(banco, { fonteId: fonte.id, antesDe: agendadaPara })
  const { situacao, aviso } = classificar({ contagens, okAnterior })
  const novos = aviso ? [aviso] : []
  const avisos = await fecharRodada(banco, { rodadaId, situacao, contagens, avisos: novos })
  return { tipo: 'FECHADA', rodadaId, situacao, contagens, avisos }
}

export async function executarRodada(
  dependencias: Dependencias,
  pedido: Pedido,
): Promise<ResultadoRodada> {
  const { banco } = dependencias
  const fonte = await lerFonte(banco, pedido.fonte)
  if (!fonte) return { tipo: 'FONTE_DESCONHECIDA' }
  if (!fonte.ativa) return { tipo: 'FONTE_INATIVA' }
  const { agendadaPara, versao } = pedido
  const tomada = await tomarRodada(banco, { fonteId: fonte.id, agendadaPara, versao })
  const { rodadaId } = tomada
  if (tomada.tipo !== 'TOMADA') return { tipo: tomada.tipo, rodadaId }
  const rodada = { ...dependencias, rodadaId }
  const aberto = ADAPTADORES[fonte.plataforma].abrir(fonte.config)
  if (aberto.tipo === 'CONFIG_INVALIDA') {
    const { motivo } = aberto
    const contagens = await contar(banco, rodadaId)
    const avisos = [{ tipo: 'CONFIG_INVALIDA', motivo }] as const
    await fecharRodada(banco, { rodadaId, situacao: 'FALHOU', contagens, avisos })
    return { tipo: 'CONFIG_INVALIDA', rodadaId, motivo }
  }
  const lotes = await preparar(rodada, aberto.plano)
  if (lotes) await coletar(rodada, lotes)
  return await fechar(rodada, fonte, agendadaPara)
}
