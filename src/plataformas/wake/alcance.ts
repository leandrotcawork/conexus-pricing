import type { Ean } from '../../dominio/marcas.ts'
import type { PedidoHttp } from '../contrato.ts'

const CONSULTA = `query($eans: [String], $n: Int!) {
  products(filters: {ean: $eans}, first: $n) {
    edges { node {
      productId productName ean alias aliasComplete available stock
      prices { price listPrice }
    } }
  }
}`

/** A Storefront API da Wake; o token é o que a própria loja publica para o navegador. */
export function pedidoDeAlcanceWake(
  { api, loja, token }: { readonly api: string; readonly loja: string; readonly token: string },
  ean: Ean,
): PedidoHttp {
  const origem = new URL(loja).origin
  return {
    url: api,
    metodo: 'POST',
    cabecalhos: {
      'content-type': 'application/json',
      accept: 'application/json',
      'tcs-access-token': token,
      origin: origem,
      referer: `${origem}/`,
    },
    corpo: JSON.stringify({ query: CONSULTA, variables: { eans: [ean], n: 50 } }),
  }
}
