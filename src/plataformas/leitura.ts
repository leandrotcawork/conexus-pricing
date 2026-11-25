import { z } from 'zod'
import type { Plataforma } from '../dominio/fonte.ts'
import type { Ean } from '../dominio/marcas.ts'
import type { Oferta } from '../dominio/observacao.ts'
import type { Adaptador, LeituraLote, PlanoDeColeta, RespostaHttp } from './contrato.ts'

export const UrlHttps = z.url({ protocol: /^https$/ })

/** Os caminhos que o Zod recusou, sem os valores: um deles pode ser um token. */
function camposRecusados(erro: z.ZodError): string {
  return [...new Set(erro.issues.map((issue) => issue.path.join('.') || '(raiz)'))].join(', ')
}

export function invalido(motivo: string) {
  return { tipo: 'INVALIDO', motivo } as const
}

export function lerCorpo<Corpo>(
  resposta: RespostaHttp,
  forma: z.ZodType<Corpo>,
  statusAceitos: readonly number[] = [200],
) {
  // o status vem antes do corpo: uma página 404 já trouxe um preço falso (jsonld.py:63-65)
  if (!statusAceitos.includes(resposta.status)) return invalido(`HTTP ${resposta.status}`)
  let corpo: unknown
  try {
    corpo = JSON.parse(resposta.corpo)
  } catch {
    return invalido('o corpo não é JSON')
  }
  const lido = forma.safeParse(corpo)
  if (!lido.success) return invalido(`forma inesperada em ${camposRecusados(lido.error)}`)
  return { tipo: 'LIDO', dados: lido.data } as const
}

type Publicada = { readonly ean: string | null | undefined; readonly oferta: Oferta }

/** Descarta o que a loja devolveu com um EAN que não foi pedido (vtex.py:49-59, tray.py:104). */
export function porEan(publicadas: readonly Publicada[], eans: readonly Ean[]): LeituraLote {
  const pedidos = new Map<string, Ean>(eans.map((ean) => [ean, ean]))
  const ofertas = new Map<Ean, Oferta[]>()
  for (const { ean, oferta } of publicadas) {
    const pedido = pedidos.get(ean?.trim() ?? '')
    if (pedido === undefined) continue
    const doEan = ofertas.get(pedido)
    if (doEan) doEan.push(oferta)
    else ofertas.set(pedido, [oferta])
  }
  return { tipo: 'LIDO', ofertas }
}

export function criarAdaptador<Config>(definicao: {
  readonly plataforma: Plataforma
  readonly config: z.ZodType<Config>
  readonly planejar: (config: Config) => PlanoDeColeta
}): Adaptador {
  return {
    plataforma: definicao.plataforma,
    abrir(config) {
      const lida = definicao.config.safeParse(config)
      if (lida.success) return { tipo: 'ABERTO', plano: definicao.planejar(lida.data) }
      const motivo = `config inválida em ${camposRecusados(lida.error)}`
      return { tipo: 'CONFIG_INVALIDA', motivo }
    },
  }
}
