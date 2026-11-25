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
