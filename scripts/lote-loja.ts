/**
 * Um lote de ensaio numa loja das migrações, sem banco: pergunta os EANs de um arquivo com as
 * regras da rodada e imprime só quantos caíram em cada situação e o tempo.
 */
import { readFileSync } from 'node:fs'
import { setTimeout as esperar } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { clienteDaRodada } from '../src/coleta/coletor.ts'
import type { Coleta } from '../src/coleta/executar.ts'
import { coletar, preparar } from '../src/coleta/executar.ts'
import type { ClienteHttp } from '../src/coleta/http.ts'
import { calarCrawlee } from '../src/coleta/http.ts'
import { Ean, ProdutoId } from '../src/dominio/marcas.ts'
import type { SituacaoObservacao } from '../src/dominio/observacao.ts'
import { SITUACOES_OBSERVACAO } from '../src/dominio/observacao.ts'
import { ADAPTADORES } from '../src/plataformas/registro.ts'
import { fonteDasMigracoes } from './fontes.ts'

const PAUSA_MINIMA_MS = 2000
const PAUSA_MAXIMA_MS = 4000
const USO = 'uso: node scripts/lote-loja.ts <código da loja> <arquivo de EANs>'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { base: { type: 'string' } },
})
const [codigo, arquivo] = z.tuple([z.string(), z.string()], USO).parse(positionals)
/** Só para o teste: manda os pedidos a uma loja de mentira nesta máquina. */
const base = z
  .url({ hostname: /^127\.0\.0\.1$/ })
  .optional()
  .parse(values.base)

/** A linha recusada é apontada pelo número: o valor é do catálogo e não vai para a tela. */
function lerEans(caminho: string): readonly Ean[] {
  const eans = readFileSync(caminho, 'utf8')
    .split('\n')
    .flatMap((linha, indice) => {
      if (linha.trim() === '') return []
      const lido = Ean.safeParse(linha.trim())
      if (!lido.success) throw new Error(`linha ${indice + 1} do arquivo: não é um EAN`)
      return [lido.data]
    })
  if (eans.length === 0) throw new Error('o arquivo não tem EAN')
  return [...new Set(eans)]
}

/** Um pedido por vez, com uma pausa sorteada antes de cada um depois do primeiro. */
function comPausa(cliente: ClienteHttp): ClienteHttp {
  let feitos = 0
  return {
    async buscar(pedidos, aoResponder) {
      for (const [indice, pedido] of pedidos.entries()) {
        const sorteio = Math.random() * (PAUSA_MAXIMA_MS - PAUSA_MINIMA_MS)
        if (feitos++ > 0) await esperar(PAUSA_MINIMA_MS + sorteio)
        await cliente.buscar([pedido], (_, resultado) => aoResponder(indice, resultado))
      }
    },
  }
}

function desviado(cliente: ClienteHttp, destino: string): ClienteHttp {
  return {
    buscar(pedidos, aoResponder) {
      const desviados = pedidos.map((pedido) => {
        const { origin, pathname, search } = new URL(pedido.url)
        const url = new URL(`${pathname}${search}`, destino).href
        return { ...pedido, url, cabecalhos: { ...pedido.cabecalhos, 'x-origem': origin } }
      })
      return cliente.buscar(desviados, aoResponder)
    },
  }
}

const { plataforma, config } = fonteDasMigracoes(codigo)
const aberto = ADAPTADORES[plataforma].abrir(config)
if (aberto.tipo === 'CONFIG_INVALIDA') throw new Error(aberto.motivo)
const produtos = lerEans(arquivo).map((ean, indice) => ({ id: ProdutoId.parse(indice + 1), ean }))

calarCrawlee()
// 20 por minuto: a repetição que o próprio cliente faz também respeita a pausa
const cliente = clienteDaRodada(20)
const situacoes = new Map<ProdutoId, SituacaoObservacao>()
const coleta: Coleta = {
  http: comPausa(base === undefined ? cliente : desviado(cliente, base)),
  async gravar({ observados }) {
    for (const { produtoId, observacao } of observados) {
      situacoes.set(produtoId, observacao.situacao)
    }
  },
}

const inicio = performance.now()
const preparo = await preparar(coleta, aberto.plano)
if (preparo?.tipo === 'PREPARO_FALHOU') throw new Error(preparo.motivo)
if (preparo) await coletar(coleta, preparo.lotes, produtos)

const obtidas = [...situacoes.values()]
for (const situacao of SITUACOES_OBSERVACAO) {
  console.log(`${situacao}: ${obtidas.filter((obtida) => obtida === situacao).length}`)
}
const semResposta = produtos.length - obtidas.length
if (semResposta > 0) console.log(`SEM_RESPOSTA: ${semResposta}`)
console.log(`tempo: ${((performance.now() - inicio) / 1000).toFixed(1)} s`)
