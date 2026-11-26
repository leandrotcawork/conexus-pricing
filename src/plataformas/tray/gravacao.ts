import { z } from 'zod'
import type { Gravador } from '../gravacao.ts'
import { precosInventados } from '../gravacao.ts'
import { Busca } from './respostas.ts'

const Recusa = z.object({ code: z.number() })
/** Não existe produto de id 0: a web_api recusa com 400. */
const ROTA_RECUSADA = '/web_api/products/0'

function inventarBusca(busca: Busca, url: string, ean: (real: string) => string) {
  const preco = precosInventados(
    busca.Products.flatMap(({ Product: p }) => [p.price, p.promotional_price]),
  )
  return {
    paging: busca.paging,
    Products: busca.Products.map(({ Product: cadastro }, indice) => ({
      Product: {
        ean: cadastro.ean && ean(cadastro.ean),
        price: preco(cadastro.price).toFixed(2),
        promotional_price: preco(cadastro.promotional_price).toFixed(2),
        available: cadastro.available,
        url: { https: new URL(`/produto-inventado-${indice + 1}`, url).href },
      },
    })),
  }
}

export const gravadorTray: Gravador = {
  truncado: (pedido) => ({ ...pedido, url: pedido.url.replace(/limit=\d+/, 'limit=1') }),
  erro: (pedido) => ({ ...pedido, url: new URL(ROTA_RECUSADA, pedido.url).href }),
  inventar({ caso, corpo, url, ean }) {
    if (caso === 'erro') {
      const { code } = Recusa.parse(JSON.parse(corpo))
      const texto = 'texto inventado'
      return JSON.stringify({ code, url: ROTA_RECUSADA, name: texto, causes: [texto] }, null, 2)
    }
    const busca = Busca.parse(JSON.parse(corpo))
    return JSON.stringify(inventarBusca(busca, url, ean), null, 2)
  },
}
