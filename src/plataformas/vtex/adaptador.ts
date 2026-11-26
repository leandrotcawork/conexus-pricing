import { z } from 'zod'
import type { Ean } from '../../dominio/marcas.ts'
import { centavosDeReais } from '../../dominio/marcas.ts'
import type { LeituraLote, PedidoHttp, RespostaHttp } from '../contrato.ts'
import { criarAdaptador, invalido, lerCorpo, porEan, UrlHttps } from '../leitura.ts'
import { Busca } from './respostas.ts'

const ROTA = '/api/catalog_system/pub/products/search'
/** A VTEX recusa uma página com mais de 50 itens (vtex.py:21-22). */
const ITENS_POR_PAGINA = 50

function pedido(origem: string, eans: readonly Ean[]): PedidoHttp {
  // `fq` repetido vale como OU (vtex.py:7-9,36-40)
  const filtros = eans.map((ean) => `fq=alternateIds_Ean:${ean}`).join('&')
  const consulta = `${filtros}&_from=0&_to=${ITENS_POR_PAGINA - 1}`
  return {
    url: new URL(`${ROTA}?${consulta}`, origem).href,
    metodo: 'GET',
    cabecalhos: { accept: 'application/json' },
    corpo: null,
  }
}

function ofertasPublicadas(busca: Busca) {
  return busca.flatMap((produto) =>
    produto.items.flatMap((item) =>
      item.sellers.map(({ sellerName, commertialOffer }) => ({
        ean: item.ean,
        oferta: {
          preco: centavosDeReais(commertialOffer.Price),
          precoLista: centavosDeReais(commertialOffer.ListPrice),
          disponivel: commertialOffer.IsAvailable,
          vendedor: sellerName,
          url: produto.link,
        },
      })),
    ),
  )
}

function ler(resposta: RespostaHttp, eans: readonly Ean[]): LeituraLote {
  // 206 é a resposta normal de uma busca paginada na VTEX (vtex.py:42-43)
  const busca = lerCorpo(resposta, Busca, [200, 206])
  if (busca.tipo === 'INVALIDO') return busca
  // `resources: 0-49/2` traz o total; sem conferir, o corte vira "não existe" (tray.py:57-62)
  const total = /\/(\d+)$/.exec(resposta.cabecalhos.resources ?? '')?.[1]
  if (total === undefined) return invalido('sem o total no cabeçalho resources')
  const recebidos = busca.dados.length
  if (Number(total) > recebidos) return invalido(`resposta cortada: ${recebidos} de ${total}`)
  return porEan(ofertasPublicadas(busca.dados), eans)
}

export const vtex = criarAdaptador({
  plataforma: 'vtex',
  config: z.object({ origem: UrlHttps, lote: z.number().int().min(1).max(ITENS_POR_PAGINA) }),
  planejar: ({ origem, lote }) => ({
    tipo: 'DIRETO',
    lotes: { maximo: lote, pedido: (eans) => pedido(origem, eans), ler },
  }),
})
