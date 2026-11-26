import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { Ean } from '../dominio/marcas.ts'
import type { Observacao } from '../dominio/observacao.ts'
import { decidir } from '../dominio/observacao.ts'
import type { Adaptador, LeituraLote, Lotes, PedidoHttp, RespostaHttp } from './contrato.ts'
import type { Caso } from './gravacao.ts'
import { lerGravacao } from './gravacao.ts'

export const EAN_A = Ean.parse('2000000000011')
export const EAN_B = Ean.parse('2000000000012')

export type Cadastro = {
  readonly ean: Ean
  readonly reais: number
  readonly disponivel: boolean
}

type Conformidade = {
  readonly adaptador: Adaptador
  readonly gravacoes: URL
  readonly config: object
  readonly camposInvalidos: readonly object[]
  readonly origens: readonly string[]
  readonly comCadastro: (corpo: string, cadastro: Cadastro) => string
}

export function gravacaoDe(pasta: URL, caso: Caso): RespostaHttp {
  return lerGravacao(readFileSync(new URL(`${caso}.txt`, pasta), 'utf8'))
}

export function abrirLotes(
  adaptador: Adaptador,
  config: object,
  preparo: () => RespostaHttp,
): { readonly lotes: Lotes; readonly preparo: PedidoHttp | null } {
  const aberto = adaptador.abrir(config)
  assert.ok(aberto.tipo === 'ABERTO')
  const { plano } = aberto
  if (plano.tipo === 'DIRETO') return { lotes: plano.lotes, preparo: null }
  const preparado = plano.lerPreparo(preparo())
  assert.ok(preparado.tipo === 'PREPARADO', JSON.stringify(preparado))
  return { lotes: preparado.lotes, preparo: plano.preparo }
}

export function lido(leitura: LeituraLote) {
  assert.ok(leitura.tipo === 'LIDO', leitura.tipo === 'INVALIDO' ? leitura.motivo : '')
  return leitura.ofertas
}

function cadastros(observacao: Observacao): number {
  return 'cadastros' in observacao ? observacao.cadastros : 0
}

function casosDeLeitura({ gravacoes, comCadastro }: Conformidade, lotes: () => Lotes): void {
  function gravacao(caso: Caso): RespostaHttp {
    return gravacaoDe(gravacoes, caso)
  }
  const ambos = [EAN_A, EAN_B]

  test('o lote gravado traz um preço disponível para cada EAN pedido', () => {
    const ofertas = lido(lotes().ler(gravacao('lote'), ambos))
    assert.deepEqual([...ofertas.keys()].sort(), ambos)
    for (const ean of ambos) assert.equal(decidir(ofertas.get(ean)).situacao, 'OK')
  })

  test('o que a loja devolve de um EAN não pedido é descartado', () => {
    const ofertas = lido(lotes().ler(gravacao('lote'), [EAN_A]))
    assert.deepEqual([...ofertas.keys()], [EAN_A])
  })

  test('entre cadastros do mesmo EAN vale o mais barato disponível', () => {
    const lote = gravacao('lote')
    const antes = decidir(lido(lotes().ler(lote, ambos)).get(EAN_A))
    const morto = comCadastro(lote.corpo, { ean: EAN_A, reais: 0.02, disponivel: false })
    const corpo = comCadastro(morto, { ean: EAN_A, reais: 0.05, disponivel: true })
    const depois = decidir(lido(lotes().ler({ ...lote, corpo }, ambos)).get(EAN_A))
    assert.ok(depois.situacao === 'OK')
    assert.equal(depois.preco, 5)
    assert.equal(depois.cadastros, cadastros(antes) + 2)
  })

  test('o lote vazio é lido sem oferta nenhuma', () => {
    assert.equal(lido(lotes().ler(gravacao('vazio'), ambos)).size, 0)
  })

  for (const caso of ['truncado', 'erro'] as const) {
    test(`a gravação ${caso} é INVALIDO, nunca um lote vazio`, () => {
      assert.equal(lotes().ler(gravacao(caso), ambos).tipo, 'INVALIDO')
    })
  }

  test('um status inesperado é INVALIDO, mesmo com preço no corpo', () => {
    for (const status of [203, 301, 404, 429, 500]) {
      const leitura = lotes().ler({ ...gravacao('lote'), status }, ambos)
      assert.deepEqual(leitura, { tipo: 'INVALIDO', motivo: `HTTP ${status}` })
    }
  })

  test('um corpo fora da forma é INVALIDO', () => {
    for (const corpo of ['<html>R$ 15,00</html>', '{}', 'null', '{"price": 15}']) {
      assert.equal(lotes().ler({ ...gravacao('lote'), corpo }, ambos).tipo, 'INVALIDO')
    }
  })
}

export function conformidade(caso: Conformidade): void {
  const { adaptador, config, origens } = caso
  function abertos() {
    return abrirLotes(adaptador, config, () => gravacaoDe(caso.gravacoes, 'preparo'))
  }

  describe(`conformidade ${adaptador.plataforma}`, () => {
    casosDeLeitura(caso, () => abertos().lotes)

    test('nenhum pedido sai das origens da config, e todos vão por HTTPS', () => {
      const { lotes, preparo } = abertos()
      const pedidos = [lotes.pedido([EAN_A, EAN_B]), ...(preparo ? [preparo] : [])]
      for (const { url } of pedidos) {
        assert.ok(origens.includes(new URL(url).origin), url)
        assert.equal(new URL(url).protocol, 'https:')
      }
    })

    test('uma config inválida é recusada sem repetir os valores', () => {
      for (const invalido of [...caso.camposInvalidos.map((c) => ({ ...config, ...c })), {}]) {
        const aberto = adaptador.abrir(invalido)
        assert.ok(aberto.tipo === 'CONFIG_INVALIDA', JSON.stringify(invalido))
        assert.match(aberto.motivo, /^config inválida em [\w, ]+$/)
      }
    })
  })
}
