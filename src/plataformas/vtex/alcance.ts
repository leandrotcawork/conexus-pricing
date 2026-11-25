import type { Ean } from '../../dominio/marcas.ts'
import type { PedidoHttp } from '../contrato.ts'

/** A busca de catálogo da VTEX por um EAN. */
export function pedidoDeAlcanceVtex(origem: string, ean: Ean): PedidoHttp {
  const url = new URL('/api/catalog_system/pub/products/search', origem)
  url.search = String(new URLSearchParams({ fq: `alternateIds_Ean:${ean}`, _from: '0', _to: '0' }))
  return { url: url.href, metodo: 'GET', cabecalhos: { accept: 'application/json' }, corpo: null }
}
