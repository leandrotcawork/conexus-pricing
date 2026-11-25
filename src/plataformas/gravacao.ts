import type { PedidoHttp, RespostaHttp } from './contrato.ts'

export type Caso = 'preparo' | 'lote' | 'vazio' | 'truncado' | 'erro'

/** O que cada plataforma sabe sobre gravar as próprias respostas. */
export type Gravador = {
  /** O mesmo pedido, alterado para a loja cortar a resposta. */
  readonly truncado: (pedido: PedidoHttp) => PedidoHttp
  /** O mesmo pedido, alterado para a loja recusar. */
  readonly erro: (pedido: PedidoHttp) => PedidoHttp
  /** Reescreve o corpo só com o que o adaptador lê, com valores inventados (S40). */
  readonly inventar: (entrada: {
    readonly caso: Caso
    readonly corpo: string
    readonly url: string
    readonly ean: (real: string) => string
  }) => string
}

/** Nenhuma loja publica este EAN: é o do pedido que volta vazio. */
export const EAN_SEM_PRODUTO = '2000000000008'
const CABECALHOS_GRAVADOS = ['content-type', 'resources']

/** Cada EAN real vira sempre o mesmo inventado. */
export function eansInventados(): (real: string) => string {
  const trocas = new Map([[EAN_SEM_PRODUTO, EAN_SEM_PRODUTO]])
  return (real) => {
    const inventado = trocas.get(real) ?? String(2_000_000_000_010 + trocas.size)
    trocas.set(real, inventado)
    return inventado
  }
}

/** Preços inventados na mesma ordem dos reais; zero continua zero. */
export function precosInventados(reais: readonly number[]): (real: number) => number {
  const ordem = [...new Set(reais.filter((real) => real > 0))].sort((a, b) => a - b)
  return (real) => (real > 0 ? (ordem.indexOf(real) + 1) * 10 + 0.9 : 0)
}

/** Primeira linha: loja, rota e data. Depois o status, os cabeçalhos e o corpo. */
export function escreverGravacao(gravacao: {
  readonly pedido: PedidoHttp
  readonly data: Date
  readonly resposta: RespostaHttp
}): string {
  const { pedido, data, resposta } = gravacao
  const { hostname, pathname, search } = new URL(pedido.url)
  const rota = `${pedido.metodo} ${pathname}${search}`
  const linhas = [
    `${hostname} · ${rota} · ${data.toISOString().slice(0, 10)}`,
    `HTTP ${resposta.status}`,
    ...CABECALHOS_GRAVADOS.flatMap((nome) => {
      const valor = resposta.cabecalhos[nome]
      return valor === undefined ? [] : [`${nome}: ${valor}`]
    }),
  ]
  return `${linhas.join('\n')}\n\n${resposta.corpo}\n`
}

export function lerGravacao(texto: string): RespostaHttp {
  const fim = texto.indexOf('\n\n')
  const [, status = '', ...cabecalhos] = texto.slice(0, fim).split('\n')
  return {
    status: Number(status.replace('HTTP ', '')),
    cabecalhos: Object.fromEntries(
      cabecalhos.map((linha) => {
        const separador = linha.indexOf(': ')
        return [linha.slice(0, separador), linha.slice(separador + 2)]
      }),
    ),
    corpo: texto.slice(fim + 2).replace(/\n$/, ''),
  }
}
