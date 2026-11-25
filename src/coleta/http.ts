import { totalmem } from 'node:os'
import type { HttpCrawlerOptions } from '@crawlee/http'
import { Configuration, HttpCrawler, NonRetryableError } from '@crawlee/http'
import type { PedidoHttp, RespostaHttp } from '../plataformas/contrato.ts'

const DETALHE_MAXIMO = 300

/** `status` é null quando a loja não respondeu; `ms` é a duração da última tentativa. */
export type ResultadoHttp =
  | { readonly tipo: 'RESPONDEU'; readonly resposta: RespostaHttp; readonly ms: number }
  | {
      readonly tipo: 'FALHOU'
      readonly detalhe: string
      readonly status: number | null
      readonly ms: number
    }

type AoResponder = (indice: number, resultado: ResultadoHttp) => Promise<void>

export type ClienteHttp = {
  /**
   * Um pedido por vez (uma conexão por loja), na ordem dada; aoResponder roda antes do próximo.
   * A repetição de um 429 ou 503 vai para o fim da fila, por isso a resposta vem com o índice.
   */
  buscar(pedidos: readonly PedidoHttp[], aoResponder: AoResponder): Promise<void>
}

type OpcoesDoCliente = {
  readonly porMinuto: number
  readonly tentativas: number
  readonly prazoPedidoMs: number
  readonly esperaMaximaMs: number
}

/** Retry-After em segundos ou data HTTP; o Crawlee 3.18.2 não lê esse cabeçalho. */
function esperaPedidaMs(valor: string | undefined, maximoMs: number): number | undefined {
  if (!valor) return undefined
  const ms = /^\d+$/.test(valor.trim()) ? Number(valor) * 1000 : Date.parse(valor) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, maximoMs) : undefined
}

function emTexto(cabecalhos: NodeJS.Dict<string | string[]>): RespostaHttp['cabecalhos'] {
  const pares = Object.entries(cabecalhos)
  return Object.fromEntries(
    pares.map(([nome, valor]) => [nome, Array.isArray(valor) ? valor.join(', ') : valor]),
  )
}

/** Um erro de quem consome não é falha da loja: não repete o pedido, para a fila e sobe. */
function criarEntrega(aoResponder: AoResponder, parar: () => void) {
  let falha: { readonly erro: unknown } | undefined
  return {
    async entregar(indice: number, resultado: ResultadoHttp): Promise<void> {
      try {
        await aoResponder(indice, resultado)
      } catch (erro) {
        falha = { erro }
        parar()
      }
    },
    conferir(): void {
      if (falha) throw falha.erro
    },
  }
}

function opcoesDaLoja(
  opcoes: OpcoesDoCliente,
  entregar: (indice: number, resultado: ResultadoHttp) => Promise<void>,
): HttpCrawlerOptions {
  const inicios = new Map<string, number>()
  function msDesde(chave: string): number {
    return Math.round(performance.now() - (inicios.get(chave) ?? 0))
  }
  return {
    maxConcurrency: 1,
    maxRequestsPerMinute: opcoes.porMinuto,
    maxRequestRetries: opcoes.tentativas,
    navigationTimeoutSecs: opcoes.prazoPedidoMs / 1000,
    // o padrão do HttpCrawler 3.18.2 é aceitar qualquer certificado
    ignoreSslErrors: false,
    additionalMimeTypes: ['*/*'],
    // 503 já é erro (>= 500)
    additionalHttpErrorStatusCodes: [429],
    // uma identidade de navegador por chamada, que 401, 403 e 429 não trocam
    sessionPoolOptions: {
      maxPoolSize: 1,
      blockedStatusCodes: [],
      sessionOptions: {
        maxUsageCount: Number.MAX_SAFE_INTEGER,
        maxErrorScore: Number.MAX_SAFE_INTEGER,
      },
    },
    preNavigationHooks: [
      async ({ request }) => {
        inicios.set(request.uniqueKey, performance.now())
      },
    ],
    errorHandler: async ({ response }) => {
      const espera = esperaPedidaMs(response?.headers['retry-after'], opcoes.esperaMaximaMs)
      if (espera) await new Promise((fim) => setTimeout(fim, espera))
    },
    requestHandler: async ({ request, response, body }) => {
      const status = response.statusCode ?? 0
      if (status === 403) throw new NonRetryableError('HTTP 403')
      const resposta = { status, cabecalhos: emTexto(response.headers), corpo: String(body) }
      const ms = msDesde(request.uniqueKey)
      await entregar(Number(request.uniqueKey), { tipo: 'RESPONDEU', resposta, ms })
    },
    failedRequestHandler: async ({ request, response }, erro) => {
      await entregar(Number(request.uniqueKey), {
        tipo: 'FALHOU',
        detalhe: erro.message.slice(0, DETALHE_MAXIMO),
        status: response?.statusCode ?? null,
        ms: msDesde(request.uniqueKey),
      })
    },
  }
}

function configuracao(): Configuration {
  return new Configuration({
    // fila e sessão só em memória: a função não tem disco, e cada chamada fica isolada
    persistStorage: false,
    // sem o teto declarado o Crawlee roda `ps` ao começar, e onde não há `ps` nada é buscado
    memoryMbytes: Math.floor(totalmem() / 1024 / 1024),
    // cada medida que falha sem `ps` vira uma linha de erro no log: uma por minuto, não por segundo
    systemInfoIntervalMillis: 60_000,
  })
}

export function clienteCrawlee(opcoes: OpcoesDoCliente): ClienteHttp {
  return {
    async buscar(pedidos, aoResponder) {
      const entrega = criarEntrega(aoResponder, (): void => crawler.stop())
      const crawler = new HttpCrawler(opcoesDaLoja(opcoes, entrega.entregar), configuracao())
      await crawler.run(
        pedidos.map((pedido, indice) => ({
          url: pedido.url,
          method: pedido.metodo,
          headers: { ...pedido.cabecalhos },
          ...(pedido.corpo === null ? {} : { payload: pedido.corpo }),
          // o índice identifica o pedido: dois pedidos iguais não são deduplicados
          uniqueKey: String(indice),
        })),
      )
      entrega.conferir()
    },
  }
}
