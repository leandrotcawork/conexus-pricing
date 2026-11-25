import type { PedidoHttp } from '../contrato.ts'
import type { Gravador } from '../gravacao.ts'
import { precosInventados } from '../gravacao.ts'
import { Busca } from './respostas.ts'

function ateOItem(pedido: PedidoHttp, ultimo: number): PedidoHttp {
  return { ...pedido, url: pedido.url.replace(/_to=\d+/, `_to=${ultimo}`) }
}

export const gravadorVtex: Gravador = {
  // um item só: `resources` continua contando todos
  truncado: (pedido) => ateOItem(pedido, 0),
  // a VTEX recusa `_to` acima de 50
  erro: (pedido) => ateOItem(pedido, 100),
  inventar({ caso, corpo, url, ean }) {
    // a recusa da VTEX é uma frase solta em JSON
    if (caso === 'erro') return JSON.stringify('texto inventado')
    const busca = Busca.parse(JSON.parse(corpo))
    const preco = precosInventados(
      busca.flatMap((produto) =>
        produto.items.flatMap((item) =>
          item.sellers.flatMap((s) => [s.commertialOffer.Price, s.commertialOffer.ListPrice]),
        ),
      ),
    )
    const inventada: Busca = busca.map((produto, indice) => ({
      link: new URL(`/produto-inventado-${indice + 1}/p`, url).href,
      items: produto.items.map((item) => ({
        ean: item.ean && ean(item.ean),
        sellers: item.sellers.map(({ commertialOffer }) => ({
          sellerName: 'Vendedor inventado',
          commertialOffer: {
            Price: preco(commertialOffer.Price),
            ListPrice: preco(commertialOffer.ListPrice),
            IsAvailable: commertialOffer.IsAvailable,
          },
        })),
      })),
    }))
    return JSON.stringify(inventada, null, 2)
  },
}
