import { z } from 'zod'
import type { Ean } from '../../dominio/marcas.ts'
import { centavosDeReais } from '../../dominio/marcas.ts'
import type { LeituraLote, PedidoHttp, RespostaHttp } from '../contrato.ts'
import { criarAdaptador, invalido, lerCorpo, porEan, UrlHttps } from '../leitura.ts'
import { Busca } from './respostas.ts'

const ROTA = '/web_api/products'
/** O teto da Tray conta cadastros, não EANs, e um EAN duplicado ocupa duas vagas (tray.py:32-36). */
const CADASTROS_POR_RESPOSTA = 50
const EANS_POR_LOTE_NO_MAXIMO = 25

function pedido(origem: string, eans: readonly Ean[]): PedidoHttp {
  const consulta = `ean=${eans.join(',')}&limit=${CADASTROS_POR_RESPOSTA}`
  return {
    url: new URL(`${ROTA}?${consulta}`, origem).href,
    metodo: 'GET',
    cabecalhos: { accept: 'application/json' },
    corpo: null,
  }
}

function ofertasPublicadas(busca: Busca) {
  // todos os cadastros do EAN entram: o primeiro pode ser um cadastro morto (tray.py:3-13)
  return busca.Products.map(({ Product: cadastro }) => {
    const { price: cheio, promotional_price: promocional } = cadastro
    return {
      ean: cadastro.ean,
      oferta: {
        // com promoção, é ela o preço cobrado (tray.py:106-108)
        preco: centavosDeReais(promocional > 0 ? promocional : cheio),
        precoLista: centavosDeReais(cheio),
        disponivel: cadastro.available === '1',
        vendedor: null,
        url: cadastro.url.https,
      },
    }
  })
}

function ler(resposta: RespostaHttp, eans: readonly Ean[]): LeituraLote {
  const busca = lerCorpo(resposta, Busca)
  if (busca.tipo === 'INVALIDO') return busca
  const { paging, Products } = busca.dados
  // a Tray corta a resposta sem avisar; o corte já virou "não existe" (tray.py:57-62)
  if (paging.total > Products.length) {
    return invalido(`resposta cortada: ${Products.length} de ${paging.total}`)
  }
  return porEan(ofertasPublicadas(busca.dados), eans)
}

export const tray = criarAdaptador({
  plataforma: 'tray',
  config: z.object({
    origem: UrlHttps,
    lote: z.number().int().min(1).max(EANS_POR_LOTE_NO_MAXIMO),
  }),
  planejar: ({ origem, lote }) => ({
    tipo: 'DIRETO',
    lotes: { maximo: lote, pedido: (eans) => pedido(origem, eans), ler },
  }),
})
