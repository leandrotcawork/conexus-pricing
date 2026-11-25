import type { Plataforma } from '../dominio/fonte.ts'
import type { Ean } from '../dominio/marcas.ts'
import type { Oferta } from '../dominio/observacao.ts'
import type { Aviso } from '../dominio/rodada.ts'

/** O que um adaptador pede e o que recebe de volta; o transporte é do `coleta/http.ts`. */
export type PedidoHttp = {
  readonly url: string
  readonly metodo: 'GET' | 'POST'
  readonly cabecalhos: Readonly<Record<string, string>>
  readonly corpo: string | null
}

export type RespostaHttp = {
  readonly status: number
  readonly cabecalhos: Readonly<Record<string, string | undefined>>
  readonly corpo: string
}

/** INVALIDO quando a resposta não merece confiança como lote: cortada, com erro, fora da forma. */
export type LeituraLote =
  | { readonly tipo: 'LIDO'; readonly ofertas: ReadonlyMap<Ean, readonly Oferta[]> }
  | { readonly tipo: 'INVALIDO'; readonly motivo: string }

export type Lotes = {
  readonly maximo: number
  pedido(eans: readonly Ean[]): PedidoHttp
  /** Só entra oferta cujo EAN publicado é igual ao pedido (vtex.py:49-59, tray.py:104). */
  ler(resposta: RespostaHttp, eans: readonly Ean[]): LeituraLote
}

export type PlanoDeColeta =
  | { readonly tipo: 'DIRETO'; readonly lotes: Lotes }
  | {
      readonly tipo: 'COM_PREPARO'
      readonly preparo: PedidoHttp
      /** null quando o preparo falhou; o adaptador decide o recuo e o declara em avisos. */
      lerPreparo(resposta: RespostaHttp | null): {
        readonly lotes: Lotes
        readonly avisos: readonly Aviso[]
      }
    }

export type Adaptador = {
  readonly plataforma: Plataforma
  /** O parse de `fonte.config`, uma vez (code C27). */
  abrir(
    config: unknown,
  ):
    | { readonly tipo: 'ABERTO'; readonly plano: PlanoDeColeta }
    | { readonly tipo: 'CONFIG_INVALIDA'; readonly motivo: string }
}
