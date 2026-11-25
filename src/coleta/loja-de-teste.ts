import type { IncomingHttpHeaders, Server } from 'node:http'
import { createServer } from 'node:http'
import { text } from 'node:stream/consumers'
import { setTimeout as esperar } from 'node:timers/promises'

type PedidoRecebido = {
  readonly caminho: string
  readonly metodo: string
  readonly cabecalhos: IncomingHttpHeaders
  readonly corpo: Promise<string>
  readonly em: number
}

type Roteada = {
  readonly status: number
  readonly cabecalhos?: Readonly<Record<string, string>>
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
