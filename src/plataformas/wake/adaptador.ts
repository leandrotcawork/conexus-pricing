import { z } from 'zod'
import type { Ean } from '../../dominio/marcas.ts'
import { centavosDeReais } from '../../dominio/marcas.ts'
import type { LeituraLote, Lotes, PedidoHttp, RespostaHttp } from '../contrato.ts'
import { criarAdaptador, invalido, lerCorpo, porEan, UrlHttps } from '../leitura.ts'
import { Resposta } from './respostas.ts'

/** A API recusa pedir mais de 50 itens por página (wake.py:36-38). */
const ITENS_POR_PAGINA = 50
const EANS_POR_LOTE_NO_MAXIMO = 25

/** O token de vitrine que a loja entrega ao navegador no HTML da home (wake.py:42,67-79). */
export const TOKEN_NO_HTML = /storefrontAccessToken["']?\s*[:=]\s*["']([A-Za-z0-9_-]{20,90})["']/

const CONSULTA = `query($eans: [String], $n: Int!) {
  products(filters: {ean: $eans}, first: $n) {
    pageInfo { hasNextPage }
    edges { node {
      ean alias aliasComplete available
      prices { price listPrice }
    } }
  }
}`

const Config = z.object({
  loja: UrlHttps,
  api: UrlHttps,
  lote: z.number().int().min(1).max(EANS_POR_LOTE_NO_MAXIMO),
  tokenReserva: z.string().min(20),
})
type Config = z.infer<typeof Config>

function pedido({ api, loja }: Config, token: string, eans: readonly Ean[]): PedidoHttp {
  const { origin } = new URL(loja)
  return {
    url: api,
    metodo: 'POST',
    cabecalhos: {
      'content-type': 'application/json',
      accept: 'application/json',
      'tcs-access-token': token,
      origin,
      referer: `${origin}/`,
    },
    corpo: JSON.stringify({ query: CONSULTA, variables: { eans, n: ITENS_POR_PAGINA } }),
  }
}

function enderecoDoProduto(loja: string, alias: string | null): string | null {
  const caminho = alias?.replace(/^\/+|\/+$/g, '')
  return caminho ? new URL(`/${caminho}`, loja).href : null
}

function ler(loja: string, resposta: RespostaHttp, eans: readonly Ean[]): LeituraLote {
  const lida = lerCorpo(resposta, Resposta)
  if (lida.tipo === 'INVALIDO') return lida
  const { errors, data } = lida.dados
  // o GraphQL responde 200 também quando falha (wake.py:94-95)
  if (errors?.length) {
    const codigos = errors.map((erro) => erro.extensions?.code ?? 'sem código').join(', ')
    return invalido(`GraphQL com errors: ${codigos}`)
  }
  if (!data?.products) return invalido('GraphQL sem products')
  if (data.products.pageInfo.hasNextPage) return invalido('resposta cortada: há outra página')
  const publicadas = data.products.edges.map(({ node }) => ({
    ean: node.ean,
    oferta: {
      preco: node.prices && centavosDeReais(node.prices.price),
      precoLista: node.prices && centavosDeReais(node.prices.listPrice),
      disponivel: node.available,
      vendedor: null,
      url: enderecoDoProduto(loja, node.aliasComplete || node.alias),
    },
  }))
  return porEan(publicadas, eans)
}

function lotesCom(config: Config, token: string): Lotes {
  return {
    maximo: config.lote,
    pedido: (eans) => pedido(config, token, eans),
    ler: (resposta, eans) => ler(config.loja, resposta, eans),
  }
}

export const wake = criarAdaptador({
  plataforma: 'wake',
  config: Config,
  planejar: (config) => ({
    tipo: 'COM_PREPARO',
    preparo: { url: config.loja, metodo: 'GET', cabecalhos: { accept: 'text/html' }, corpo: null },
    lerPreparo(resposta) {
      const lido = resposta?.status === 200 ? TOKEN_NO_HTML.exec(resposta.corpo)?.[1] : undefined
      if (lido) return { lotes: lotesCom(config, lido), avisos: [] }
      // o MetalPrice caía na reserva calado (wake.py:73-78)
      return {
        lotes: lotesCom(config, config.tokenReserva),
        avisos: [{ tipo: 'TOKEN_RESERVA_EM_USO' }],
      }
    },
  }),
})
