import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decidir } from '../../dominio/observacao.ts'
import type { Cadastro } from '../conformidade.ts'
import { abrirLotes, conformidade, EAN_A, EAN_B, gravacaoDe, lido } from '../conformidade.ts'
import { tray } from './adaptador.ts'

const GRAVACOES = new URL('./gravacoes/', import.meta.url)
const ORIGEM = 'https://www.condec.com.br'
const CONFIG = { origem: ORIGEM, lote: 25 }

type Corpo = {
  paging: object
  Products: { Product: Record<string, unknown> }[]
}

function lerCorpoGravado(corpo: string): Corpo {
  const lidoDoTexto: Corpo = JSON.parse(corpo)
  return lidoDoTexto
}

function comCadastro(corpo: string, { ean, reais, disponivel }: Cadastro): string {
  const busca = lerCorpoGravado(corpo)
  const modelo = busca.Products.find((entrada) => entrada.Product.ean === ean)
  assert.ok(modelo)
  const copia = structuredClone(modelo)
  Object.assign(copia.Product, {
    price: reais.toFixed(2),
    promotional_price: '0.00',
    available: disponivel ? '1' : '0',
  })
  return JSON.stringify({ ...busca, Products: [...busca.Products, copia] })
}

conformidade({
  adaptador: tray,
  gravacoes: GRAVACOES,
  config: CONFIG,
  camposInvalidos: [{ lote: 26 }, { lote: 1.5 }, { origem: 'http://www.condec.com.br' }],
  origens: [ORIGEM],
  comCadastro,
})

describe('Tray', () => {
  const { lotes } = abrirLotes(tray, CONFIG, () => assert.fail('a Tray não tem preparo'))
  const lote = gravacaoDe(GRAVACOES, 'lote')

  function comPrimeiroCadastro(campos: object) {
    const busca = lerCorpoGravado(lote.corpo)
    const [primeiro] = busca.Products
    assert.ok(primeiro)
    Object.assign(primeiro.Product, campos)
    const corpo = JSON.stringify({ paging: { total: 1 }, Products: [primeiro] })
    return lotes.ler({ ...lote, corpo }, [EAN_A, EAN_B])
  }

  test('o pedido junta os EANs e pede o teto de cadastros', () => {
    assert.equal(
      lotes.pedido([EAN_A, EAN_B]).url,
      `${ORIGEM}/web_api/products?ean=${EAN_A},${EAN_B}&limit=50`,
    )
  })

  test('o cadastro morto não vence o ativo, e o preço é o da promoção', () => {
    const ofertas = lido(lotes.ler(lote, [EAN_A, EAN_B]))
    assert.deepEqual(decidir(ofertas.get(EAN_A)), {
      situacao: 'OK',
      preco: 5090,
      precoLista: 6090,
      vendedor: null,
      url: `${ORIGEM}/produto-inventado-2`,
      cadastros: 2,
    })
    const doB = decidir(ofertas.get(EAN_B))
    assert.ok(doB.situacao === 'OK')
    assert.equal(doB.preco, 2090)
  })

  test('sem promoção vale o preço cheio', () => {
    const leitura = comPrimeiroCadastro({ price: '12.34', promotional_price: '0.00' })
    const observacao = decidir(lido(leitura).get(EAN_B))
    assert.ok(observacao.situacao === 'OK')
    assert.equal(observacao.preco, 1234)
  })

  for (const campos of [{ price: '' }, { price: 'consulte' }, { available: 'sim' }]) {
    test(`um campo ilegível (${JSON.stringify(campos)}) é INVALIDO`, () => {
      assert.equal(comPrimeiroCadastro(campos).tipo, 'INVALIDO')
    })
  }
})
