import type { Ean } from '../../dominio/marcas.ts'
import type { PedidoHttp } from '../contrato.ts'

/** A API pública de produtos da Tray filtrada por um EAN. */
export function pedidoDeAlcanceTray(origem: string, ean: Ean): PedidoHttp {
  const url = new URL('/web_api/products', origem)
  url.search = String(new URLSearchParams({ ean, limit: '50' }))
  return { url: url.href, metodo: 'GET', cabecalhos: { accept: 'application/json' }, corpo: null }
}
