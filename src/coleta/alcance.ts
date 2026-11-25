import { z } from 'zod'
import { Ean } from '../dominio/marcas.ts'
import type { PedidoHttp } from '../plataformas/contrato.ts'
import { pedidoDeAlcanceTray } from '../plataformas/tray/alcance.ts'
import { pedidoDeAlcanceVtex } from '../plataformas/vtex/alcance.ts'
import { pedidoDeAlcanceWake } from '../plataformas/wake/alcance.ts'
import { clienteCrawlee } from './http.ts'

/** O EAN e o token vêm de quem chama: o repositório não guarda nenhum dos dois. */
export const PedidoDeAlcance = z.object({ ean: Ean, tokenAbc: z.string().min(1) })
export type PedidoDeAlcance = z.infer<typeof PedidoDeAlcance>

/** Prova de rede da etapa E1; os endereços passam a vir de `fonte.config` com os adaptadores. */
const ALVOS = {
  telhanorte: 'https://www.telhanorte.com.br',
  condec: 'https://www.condec.com.br',
  abc: {
    api: 'https://storefront-api.fbits.net/graphql',
    loja: 'https://www.abcdaconstrucao.com.br',
  },
}
export type Alvos = typeof ALVOS

type Alcance = {
  readonly loja: keyof Alvos
  readonly status: number | null
  readonly ms: number
  readonly falha?: string
}

async function alcancar(loja: keyof Alvos, pedido: PedidoHttp): Promise<Alcance> {
  const cliente = clienteCrawlee({
    porMinuto: 60,
    tentativas: 0,
    prazoPedidoMs: 25_000,
    esperaMaximaMs: 0,
    tetoBytes: 10 * 1024 * 1024,
    prazoFinal: new Date(Date.now() + 60_000),
  })
  let alcance: Alcance = { loja, status: null, ms: 0, falha: 'pedido sem resposta' }
  await cliente.buscar([pedido], async (_, resultado) => {
    alcance =
      resultado.tipo === 'RESPONDEU'
        ? { loja, status: resultado.resposta.status, ms: resultado.ms }
        : { loja, status: resultado.status, ms: resultado.ms, falha: resultado.detalhe }
  })
  return alcance
}

/** Um pedido a cada loja, com o status e o tempo de cada um. */
export async function alcancarLojas(
  { ean, tokenAbc }: PedidoDeAlcance,
  alvos: Alvos = ALVOS,
): Promise<readonly Alcance[]> {
  return await Promise.all([
    alcancar('telhanorte', pedidoDeAlcanceVtex(alvos.telhanorte, ean)),
    alcancar('condec', pedidoDeAlcanceTray(alvos.condec, ean)),
    alcancar('abc', pedidoDeAlcanceWake({ ...alvos.abc, token: tokenAbc }, ean)),
  ])
}
