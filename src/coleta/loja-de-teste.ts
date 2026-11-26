import { readFileSync } from 'node:fs'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { createServer } from 'node:http'
import { text } from 'node:stream/consumers'
import { setTimeout as esperar } from 'node:timers/promises'
import type { Plataforma } from '../dominio/fonte.ts'
import type { RespostaHttp } from '../plataformas/contrato.ts'
import type { Caso } from '../plataformas/gravacao.ts'
import { lerGravacao } from '../plataformas/gravacao.ts'
import type { ClienteHttp } from './http.ts'
import { clienteCrawlee, TETO_BYTES_POR_RESPOSTA } from './http.ts'

type PedidoRecebido = {
  readonly caminho: string
  readonly metodo: string
  readonly cabecalhos: IncomingHttpHeaders
  readonly corpo: Promise<string>
  readonly em: number
}

type Roteada = {
  readonly status: number
  readonly cabecalhos?: RespostaHttp['cabecalhos']
  readonly corpo?: string | Uint8Array
  readonly atrasoMs?: number
}

/** `vez` conta as chegadas do mesmo caminho, a partir de 1. */
type Roteiro = (pedido: PedidoRecebido, vez: number) => Roteada

export async function escutar(servidor: Server): Promise<number> {
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
  const endereco = servidor.address()
  if (endereco === null || typeof endereco === 'string') throw new Error('servidor sem porta')
  return endereco.port
}

export async function fecharServidor(servidor: Server): Promise<void> {
  servidor.closeAllConnections()
  await new Promise((fechado) => servidor.close(fechado))
}

/** Uma loja em loopback que anota o que recebeu e responde o que o teste mandar. */
export async function abrirLojaDeTeste(roteiro: Roteiro) {
  const pedidos: PedidoRecebido[] = []
  let emVoo = 0
  let maximo = 0
  const servidor = createServer(async (entrada, saida) => {
    maximo = Math.max(maximo, ++emVoo)
    saida.on('close', () => emVoo--)
    const pedido = {
      caminho: entrada.url ?? '',
      metodo: entrada.method ?? '',
      cabecalhos: entrada.headers,
      corpo: text(entrada),
      em: performance.now(),
    }
    pedidos.push(pedido)
    const vez = pedidos.filter((p) => p.caminho === pedido.caminho).length
    const roteada = roteiro(pedido, vez)
    // um pequeno atraso para dois pedidos simultâneos se enxergarem
    await esperar(roteada.atrasoMs ?? 5, undefined, { ref: false })
    saida.writeHead(roteada.status, { 'content-type': 'text/plain', ...roteada.cabecalhos })
    saida.end(roteada.corpo ?? '')
  })
  const porta = await escutar(servidor)
  return {
    pedidos,
    maximoEmVoo: () => maximo,
    url: (caminho: string) => `http://127.0.0.1:${porta}${caminho}`,
    async [Symbol.asyncDispose]() {
      await fecharServidor(servidor)
    },
  }
}

export function clienteNaLojaDeTeste(
  base: string,
  opcoes: { readonly prazoMs?: number } = {},
): ClienteHttp {
  const cliente = clienteCrawlee({
    porMinuto: 60_000,
    tentativas: 1,
    prazoPedidoMs: 10_000,
    esperaMaximaMs: 1000,
    tetoBytes: TETO_BYTES_POR_RESPOSTA,
    prazoFinal: new Date(Date.now() + (opcoes.prazoMs ?? 60_000)),
  })
  return {
    buscar(pedidos, aoResponder) {
      const desviados = pedidos.map((pedido) => {
        const { origin, pathname, search } = new URL(pedido.url)
        const url = new URL(`${pathname}${search}`, base).href
        return { ...pedido, url, cabecalhos: { ...pedido.cabecalhos, 'x-origem': origin } }
      })
      return cliente.buscar(desviados, aoResponder)
    },
  }
}

const PLATAFORMA_DA_ORIGEM: Readonly<Record<string, Plataforma>> = {
  'https://www.telhanorte.com.br': 'vtex',
  'https://www.condec.com.br': 'tray',
  'https://www.abcdaconstrucao.com.br': 'wake',
  'https://storefront-api.fbits.net': 'wake',
}

export function comGravacao(pedido: PedidoRecebido, caso: Caso = 'lote'): Roteada {
  const plataforma = PLATAFORMA_DA_ORIGEM[String(pedido.cabecalhos['x-origem'])]
  if (!plataforma) return { status: 404 }
  const gravado = plataforma === 'wake' && pedido.metodo === 'GET' ? 'preparo' : caso
  const arquivo = new URL(`../plataformas/${plataforma}/gravacoes/${gravado}.txt`, import.meta.url)
  return lerGravacao(readFileSync(arquivo, 'utf8'))
}
