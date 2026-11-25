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
  | { readonly tipo: 'LOTE_REFEITO_UM_A_UM'; readonly eans: number; readonly motivo: string } // vtex.py:76-84
  | { readonly tipo: 'QUEDA_DE_OK'; readonly anterior: number; readonly atual: number }
  | { readonly tipo: 'PRAZO_ESGOTADO'; readonly faltaram: number }

export type Contagens = { readonly [S in SituacaoObservacao]: number }
