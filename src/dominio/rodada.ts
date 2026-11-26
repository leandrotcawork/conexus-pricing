import type { SituacaoObservacao } from './observacao.ts'

export const SITUACOES_RODADA = [
  'RODANDO',
  'CONCLUIDA',
  'SUSPEITA',
  'FALHOU',
  'INTERROMPIDA',
] as const
export type SituacaoRodada = (typeof SITUACOES_RODADA)[number]

export type Aviso =
  | { readonly tipo: 'TOKEN_RESERVA_EM_USO' } // wake.py:73-78
  | { readonly tipo: 'PREPARO_FALHOU'; readonly motivo: string }
  | { readonly tipo: 'LOTE_REFEITO_UM_A_UM'; readonly eans: number; readonly motivo: string } // vtex.py:76-84
  | { readonly tipo: 'QUEDA_DE_OK'; readonly anterior: number; readonly atual: number }
  | { readonly tipo: 'PRAZO_ESGOTADO'; readonly faltaram: number }
  | { readonly tipo: 'CONFIG_INVALIDA'; readonly motivo: string }

export type Contagens = { readonly [S in SituacaoObservacao]: number }

/** Um palpite do primeiro estudo, ainda não medido: menos da metade dos OK de antes é suspeito. */
const FRACAO_MINIMA_DE_OK = 0.5

export function classificar(rodada: {
  readonly contagens: Contagens
  readonly okAnterior: number | null
}): { readonly situacao: 'CONCLUIDA' | 'SUSPEITA'; readonly aviso: Aviso | null } {
  const { contagens, okAnterior } = rodada
  if (okAnterior === null || contagens.OK >= okAnterior * FRACAO_MINIMA_DE_OK) {
    return { situacao: 'CONCLUIDA', aviso: null }
  }
  const aviso = { tipo: 'QUEDA_DE_OK', anterior: okAnterior, atual: contagens.OK } as const
  return { situacao: 'SUSPEITA', aviso }
}
