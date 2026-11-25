import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Centavos, centavosDeReais } from './marcas.ts'
import type { Oferta } from './observacao.ts'
import { decidir } from './observacao.ts'

function centavos(valor: number): Centavos {
  return Centavos.parse(valor)
}

function oferta(parcial: Partial<Oferta>): Oferta {
  return {
    preco: null,
    precoLista: null,
    disponivel: true,
    vendedor: null,
    url: null,
    ...parcial,
  }
}

describe('decidir', () => {
  test('sem oferta alguma, a loja não tem o produto', () => {
    assert.deepEqual(decidir(undefined), { situacao: 'NAO_ENCONTRADO' })
    assert.deepEqual(decidir([]), { situacao: 'NAO_ENCONTRADO' })
  })

  test('ofertas sem preço dão SEM_PRECO, com a url da primeira', () => {
    const ofertas = [
      oferta({ url: 'https://loja.example/a', disponivel: true }),
      oferta({ url: 'https://loja.example/b', disponivel: false }),
    ]
    assert.deepEqual(decidir(ofertas), { situacao: 'SEM_PRECO', url: 'https://loja.example/a' })
  })

  test('nenhuma oferta disponível dá SEM_ESTOQUE com a mais barata', () => {
    const ofertas = [
      oferta({ preco: centavos(1500), disponivel: false, vendedor: 'cara' }),
      oferta({ preco: centavos(900), disponivel: false, vendedor: 'barata' }),
    ]
    assert.deepEqual(decidir(ofertas), {
      situacao: 'SEM_ESTOQUE',
      preco: 900,
      vendedor: 'barata',
      url: null,
      cadastros: 2,
    })
  })

  test('com duplicata, vale a mais barata entre as disponíveis', () => {
    const ofertas = [
      oferta({ preco: centavos(500), disponivel: false, vendedor: 'sem-estoque' }),
      oferta({ preco: centavos(1200), precoLista: centavos(1500), vendedor: 'cara' }),
      oferta({ preco: centavos(800), precoLista: centavos(1000), vendedor: 'barata' }),
      oferta({ preco: null, vendedor: 'sem-preco' }),
    ]
    assert.deepEqual(decidir(ofertas), {
      situacao: 'OK',
      preco: 800,
      precoLista: 1000,
      vendedor: 'barata',
      url: null,
      cadastros: 4,
    })
  })

  test('entre ofertas disponíveis de mesmo preço, vale a primeira', () => {
    const ofertas = [
      oferta({ preco: centavos(700), vendedor: 'primeira' }),
      oferta({ preco: centavos(700), vendedor: 'segunda' }),
    ]
    const observacao = decidir(ofertas)
    assert.equal(observacao.situacao, 'OK')
    assert.equal(observacao.situacao === 'OK' ? observacao.vendedor : undefined, 'primeira')
  })
})

describe('preço nunca é zero nem negativo', () => {
  test('centavosDeReais recusa zero, negativo e não finito', () => {
    assert.equal(centavosDeReais(0), null)
    assert.equal(centavosDeReais(-1), null)
    assert.equal(centavosDeReais(Number.NaN), null)
    assert.equal(centavosDeReais(Number.POSITIVE_INFINITY), null)
  })

  test('centavosDeReais converte reais em ponto flutuante sem perder o centavo', () => {
    assert.equal(centavosDeReais(19.9), 1990)
    assert.equal(centavosDeReais(0.1 + 0.2), 30)
  })

  test('um preço de zero reais vira ausência, e a oferta cai em SEM_PRECO', () => {
    const preco = centavosDeReais(0)
    assert.deepEqual(decidir([oferta({ preco, url: 'https://loja.example/zero' })]), {
      situacao: 'SEM_PRECO',
      url: 'https://loja.example/zero',
    })
  })

  test('Centavos recusa zero e negativo na criação', () => {
    assert.throws(() => Centavos.parse(0))
    assert.throws(() => Centavos.parse(-100))
  })
})
