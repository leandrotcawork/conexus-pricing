import { totalmem } from 'node:os'
import { Readable } from 'node:stream'
import { setTimeout as esperar } from 'node:timers/promises'
import type { HttpCrawlerOptions, HttpCrawlingContext } from '@crawlee/http'
import { Configuration, HttpCrawler, log, NonRetryableError, Session } from '@crawlee/http'
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

/** Um cliente por rodada: navegador, cookies e ritmo por minuto valem em todas as chamadas. */
export type ClienteHttp = {
  /**
   * Um pedido por vez (uma conexão por loja), na ordem dada; aoResponder roda antes do próximo.
   * A repetição de um 429 ou 503 vai para o fim da fila, por isso a resposta vem com o índice.
   * Um pedido que não começou até o prazo final não é feito, e aoResponder não é chamado para ele.
   * Uma chamada por vez em cada cliente.
   */
  buscar(pedidos: readonly PedidoHttp[], aoResponder: AoResponder): Promise<void>
}

type OpcoesDoCliente = {
  readonly porMinuto: number
  readonly tentativas: number
  readonly prazoPedidoMs: number
  readonly esperaMaximaMs: number
  readonly tetoBytes: number
  readonly prazoFinal: Date
}

/**
 * Teto por resposta (code C59). A maior medida tem 1,6 MB (a home da ABC); um lote de 50 da VTEX,
 * com os 45 KB do maior produto visto, chegaria a 2,3 MB.
 */
export const TETO_BYTES_POR_RESPOSTA = 10 * 1024 * 1024

class ForaDoPrazo extends NonRetryableError {}

/** Retry-After em segundos ou data HTTP; o Crawlee 3.18.2 não lê esse cabeçalho. */
function esperaPedidaMs(valor: string | undefined, maximoMs: number): number | undefined {
  if (!valor) return undefined
  const ms = /^\d+$/.test(valor.trim()) ? Number(valor) * 1000 : Date.parse(valor) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, maximoMs) : undefined
}

function emTexto(cabecalhos: NodeJS.Dict<string | string[]>): RespostaHttp['cabecalhos'] {
  // o HTTP/2 traz `:status` como número entre os cabeçalhos, e o status já vai à parte
  const pares = Object.entries(cabecalhos).filter(([nome]) => !nome.startsWith(':'))
  return Object.fromEntries(
    pares.map(([nome, valor]) => [nome, Array.isArray(valor) ? valor.join(', ') : valor]),
  )
}

/**
 * O Crawlee lê o corpo inteiro na memória e não tem teto: troca o fluxo da resposta por um que
 * conta os bytes. O gerador só puxa a origem quando alguém lê, então o erro sempre tem quem ouça.
 */
function limitarCorpo(contexto: HttpCrawlingContext, tetoBytes: number): void {
  const { request, response: origem } = contexto
  async function* contado() {
    let total = 0
    for await (const pedaco of origem) {
      total += pedaco.length
      if (total > tetoBytes) {
        request.noRetry = true
        throw new Error(`resposta passou do teto de ${tetoBytes} bytes`)
      }
      yield pedaco
    }
  }
  const { statusCode, headers, url } = origem
  const limitada = Object.assign(Readable.from(contado(), { objectMode: false }), {
    statusCode,
    headers,
    url,
  })
  Object.assign(contexto, { response: limitada })
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

type Ganchos = {
  readonly entregar: AoResponder
  readonly parar: () => void
}

function opcoesDaLoja(opcoes: OpcoesDoCliente, { entregar, parar }: Ganchos): HttpCrawlerOptions {
  const inicios = new Map<string, number>()
  let sessao: Session | undefined
  // o maxRequestsPerMinute do Crawlee 3.18.2 zera a cada run(), e uma rodada faz várias chamadas
  const intervaloMs = 60_000 / opcoes.porMinuto
  let proximoInicio = 0
  function msDesde(chave: string): number {
    return Math.round(performance.now() - (inicios.get(chave) ?? 0))
  }
  function restanteMs(): number {
    return opcoes.prazoFinal.getTime() - Date.now()
  }
  function pausar(response: HttpCrawlingContext['response'] | undefined): number {
    const espera = esperaPedidaMs(response?.headers['retry-after'], opcoes.esperaMaximaMs) ?? 0
    proximoInicio = Math.max(proximoInicio, performance.now() + espera)
    return espera
  }
  return {
    maxConcurrency: 1,
    maxRequestRetries: opcoes.tentativas,
    navigationTimeoutSecs: opcoes.prazoPedidoMs / 1000,
    // o padrão do HttpCrawler 3.18.2 é aceitar qualquer certificado
    ignoreSslErrors: false,
    additionalMimeTypes: ['*/*'],
    // 503 já é erro (>= 500)
    additionalHttpErrorStatusCodes: [429],
    sessionPoolOptions: {
      maxPoolSize: 1,
      // 401, 403 e 429 não são "sessão bloqueada": não há outra identidade para tentar
      blockedStatusCodes: [],
      // cada run() abre um pool novo; devolver a mesma sessão mantém navegador e cookies
      createSessionFunction: (sessionPool) => {
        sessao ??= new Session({
          sessionPool,
          maxUsageCount: Number.MAX_SAFE_INTEGER,
          maxErrorScore: Number.MAX_SAFE_INTEGER,
        })
        return sessao
      },
    },
    preNavigationHooks: [
      async ({ request }) => {
        const folgaMs = Math.max(0, proximoInicio - performance.now())
        const cabe = folgaMs < restanteMs()
        if (cabe) await esperar(folgaMs)
        if (!cabe || restanteMs() <= 0) {
          parar()
          request.noRetry = true
          throw new ForaDoPrazo('prazo final da rodada')
        }
        const inicio = performance.now()
        proximoInicio = inicio + intervaloMs
        inicios.set(request.uniqueKey, inicio)
      },
    ],
    postNavigationHooks: [async (contexto) => limitarCorpo(contexto, opcoes.tetoBytes)],
    errorHandler: async ({ response }) => {
      const espera = pausar(response)
      // a repetição que não cabe no prazo fica sem resposta, para a próxima entrega
      if (espera >= restanteMs()) parar()
      else await esperar(espera)
    },
    requestHandler: async ({ request, response, body }) => {
      const status = response.statusCode ?? 0
      if (status === 403) throw new NonRetryableError('HTTP 403')
      const resposta = { status, cabecalhos: emTexto(response.headers), corpo: String(body) }
      const ms = msDesde(request.uniqueKey)
      await entregar(Number(request.uniqueKey), { tipo: 'RESPONDEU', resposta, ms })
    },
    failedRequestHandler: async ({ request, response }, erro) => {
      pausar(response)
      if (erro instanceof ForaDoPrazo) return
      await entregar(Number(request.uniqueKey), {
        tipo: 'FALHOU',
        detalhe: erro.message.slice(0, DETALHE_MAXIMO),
        status: response?.statusCode ?? null,
        ms: msDesde(request.uniqueKey),
      })
    },
  }
}

/** Para quem imprime só o próprio resultado: vale para os clientes criados depois da chamada. */
export function calarCrawlee(): void {
  log.setLevel(log.LEVELS.OFF)
}

function configuracao(): Configuration {
  return new Configuration({
    // fila e sessão só em memória: nada vai para o disco, e cada cliente fica isolado
    persistStorage: false,
    // sem o teto declarado o Crawlee roda `ps` ao começar, e onde não há `ps` nada é buscado
    memoryMbytes: Math.floor(totalmem() / 1024 / 1024),
    // cada medida que falha sem `ps` vira uma linha de erro no log: uma por minuto, não por segundo
    systemInfoIntervalMillis: 60_000,
  })
}

export function clienteCrawlee(opcoes: OpcoesDoCliente): ClienteHttp {
  let entrega: ReturnType<typeof criarEntrega> | undefined
  const crawler: HttpCrawler<HttpCrawlingContext> = new HttpCrawler(
    opcoesDaLoja(opcoes, {
      entregar: async (indice, resultado) => entrega?.entregar(indice, resultado),
      parar: (): void => crawler.stop(),
    }),
    configuracao(),
  )
  return {
    async buscar(pedidos, aoResponder) {
      if (entrega) throw new Error('este cliente já está numa chamada')
      const atual = criarEntrega(aoResponder, (): void => crawler.stop())
      entrega = atual
      try {
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
      } finally {
        entrega = undefined
      }
      atual.conferir()
    },
  }
}
