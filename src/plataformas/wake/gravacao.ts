import { z } from 'zod'
import type { PedidoHttp } from '../contrato.ts'
import type { Gravador } from '../gravacao.ts'
import { precosInventados } from '../gravacao.ts'
import { TOKEN_NO_HTML } from './adaptador.ts'
import { Resposta } from './respostas.ts'

const TOKEN_INVENTADO = 'tcs_inventado_00000000000000000000'
const Consulta = z.object({ query: z.string(), variables: z.object({ eans: z.array(z.string()) }) })

function porPagina(pedido: PedidoHttp, n: number): PedidoHttp {
  const { query, variables } = Consulta.parse(JSON.parse(pedido.corpo ?? ''))
  return { ...pedido, corpo: JSON.stringify({ query, variables: { ...variables, n } }) }
}

function inventarHome(html: string): string {
  const [trecho, token] = TOKEN_NO_HTML.exec(html) ?? []
  if (!trecho || !token) return '<!doctype html>\n<title>sem token</title>'
  const declarado = trecho.replace(token, TOKEN_INVENTADO)
  return `<!doctype html>\n<script>const clientConfig={${declarado}}</script>`
}

function inventarProdutos(resposta: Resposta, ean: (real: string) => string): Resposta {
  const products = resposta.data?.products
  if (!products) {
    const errors = resposta.errors?.map((erro) => ({ ...erro, message: 'texto inventado' }))
    return { errors, data: { products: null } }
  }
  const preco = precosInventados(
    products.edges.flatMap(({ node }) =>
      node.prices ? [node.prices.price, node.prices.listPrice] : [],
    ),
  )
  const edges = products.edges.map(({ node }, indice) => {
    const alias = `produto-inventado-${indice + 1}`
    const prices = node.prices && {
      price: preco(node.prices.price),
      listPrice: preco(node.prices.listPrice),
    }
    return {
      node: {
        ean: node.ean && ean(node.ean),
        alias,
        aliasComplete: `produto/${alias}`,
        available: node.available,
        prices,
      },
    }
  })
  return { data: { products: { pageInfo: products.pageInfo, edges } } }
}

export const gravadorWake: Gravador = {
  truncado: (pedido) => porPagina(pedido, 1),
  // acima de 50 itens por página a API responde 200 com errors
  erro: (pedido) => porPagina(pedido, 500),
  inventar({ caso, corpo, ean }) {
    if (caso === 'preparo') return inventarHome(corpo)
    const resposta = Resposta.parse(JSON.parse(corpo))
    return JSON.stringify(inventarProdutos(resposta, ean), null, 2)
  },
}
