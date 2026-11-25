import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Codprod, Ean } from './marcas.ts'
import type { Movimento, ProdutoDoCatalogo, TipoDeMovimento } from './recorte.ts'
import { recorteR3 } from './recorte.ts'

function produto(codigo: number): ProdutoDoCatalogo {
  return {
    codprod: Codprod.parse(String(codigo)),
    ean: Ean.parse('2000000000015'),
    referenciaFabricante: null,
    descricao: `Item ${codigo}`,
    marca: null,
    nossoPreco: null,
  }
}

function movimento(
  codigo: number,
  tipo: TipoDeMovimento,
  centavos: number,
  operacao = 'MOVIMENTO COMUM',
): Movimento {
  return { codprod: Codprod.parse(String(codigo)), tipo, operacao, centavos }
}

function venda(codigo: number, centavos: number) {
  return movimento(codigo, 'VENDA', centavos)
}

function compra(codigo: number) {
  return movimento(codigo, 'COMPRA', 1)
}

function classes(quantos: number, movimentos: readonly Movimento[]) {
  const universo = Array.from({ length: quantos }, (_, indice) => produto(indice + 1))
  return recorteR3(universo, movimentos).map(
    (item) => `${item.produto.codprod}:${item.classe}` as const,
  )
}

describe('a curva ABC', () => {
  test('com o acumulado antes logo abaixo de 80% ainda é A, e de 95% ainda é B', () => {
    const noCorteDeA = [venda(1, 7999), venda(2, 1501), venda(3, 500)]
    assert.deepEqual(classes(3, [...noCorteDeA, compra(3)]), ['1:A', '2:A', '3:C'])
    const noCorteDeB = [venda(1, 8000), venda(2, 1499), venda(3, 501)]
    assert.deepEqual(classes(3, noCorteDeB), ['1:A', '2:B', '3:B'])
  })

  test('o acumulado de exatamente 80% é B e o de exatamente 95% é C', () => {
    const vendas = [venda(1, 8000), venda(2, 1500), venda(3, 500)]
    assert.deepEqual(classes(3, vendas), ['1:A', '2:B'])
    assert.deepEqual(classes(3, [...vendas, compra(3)]), ['1:A', '2:B', '3:C'])
  })

  test('A e B entram sem compra; C só entra com compra', () => {
    const vendas = [venda(1, 8000), venda(2, 1500), venda(3, 300), venda(4, 200)]
    assert.deepEqual(classes(4, [...vendas, compra(4)]), ['1:A', '2:B', '4:C'])
  })

  test('no empate de valor o código menor vem antes, em qualquer ordem de leitura', () => {
    const universo = [produto(1), produto(2), produto(3)]
    const vendas = [venda(1, 9000), venda(2, 500), venda(3, 500)]
    for (const lidos of [universo, universo.toReversed()]) {
      const entraram = recorteR3(lidos, vendas).map((item) => item.produto.codprod)
      assert.deepEqual(entraram, ['1', '2'])
    }
  })

  test('sem venda líquida positiva não entra, mesmo comprado, nem pesa no total', () => {
    const vendas = [venda(1, 8000), venda(2, 2000), venda(3, 100)]
    const devolvido = movimento(3, 'DEVOLUCAO', 9000)
    const movimentos = [...vendas, devolvido, compra(3), compra(4)]
    assert.deepEqual(classes(4, movimentos), ['1:A', '2:B'])
  })

  test('um movimento de produto fora do universo não pesa na curva', () => {
    assert.deepEqual(classes(2, [venda(1, 800), venda(2, 200), venda(9, 100000)]), ['1:A', '2:B'])
  })

  test('a venda líquida soma as operações e desconta a devolução', () => {
    const movimentos = [venda(1, 500), venda(1, 600), movimento(1, 'DEVOLUCAO', 900), venda(2, 800)]
    assert.deepEqual(classes(2, movimentos), ['2:A', '1:B'])
  })
})

/** Um produto C que só entra pela compra, para ver se a operação de compra conta. */
function comprouCom(operacao: string) {
  const movimentos = [venda(1, 9600), venda(2, 400), movimento(2, 'COMPRA', 1, operacao)]
  return classes(2, movimentos).length === 2
}

/** O produto 2 vendeu só nesta operação: ele aparece na curva se ela conta como venda. */
function vendeuCom(operacao: string) {
  return classes(2, [venda(1, 100), movimento(2, 'VENDA', 100, operacao)]).length === 2
}

/** A devolução, quando conta, zera o produto 2. */
function devolveuCom(operacao: string) {
  const movimentos = [venda(1, 100), venda(2, 100), movimento(2, 'DEVOLUCAO', 100, operacao)]
  return classes(2, movimentos).length === 1
}

const FORA = [
  'Transferência entre filiais',
  'REMESSA EM CONSIGNAÇÃO',
  'NFS-E DE SERVIÇO',
  'BONIFICAÇÃO',
  'CONSUMO INTERNO',
  'QUEBRAS',
  'PERDA DE MERCADORIA',
  'NOTA DENEGADA',
  'COMPLEMENTO DE ICMS',
  'ATIVO IMOBILIZADO',
  'ENERGIA ELÉTRICA',
  'TELECOMUNICAÇÃO',
  'AJUSTE DE INVENTÁRIO',
  'SHOW ROOM',
  'AMOSTRA GRÁTIS',
  'COMODATO',
  'OUTRAS ENTRADAS',
  'OUTRAS SAÍDAS',
  'NOTA DE TESTE',
  'RESERVA',
  'LANÇAMENTO DE DESPESA',
  'LCT FINANCEIRO',
  'EMPRÉSTIMO',
]

describe('a operação comercial, pela descrição', () => {
  for (const operacao of FORA) {
    test(`${operacao} não é venda nem compra`, () => {
      assert.deepEqual([vendeuCom(operacao), comprouCom(operacao)], [false, false])
    })
  }

  for (const operacao of ['VENDA', 'VENDA COMISSIONADA', 'COMPRA PARA REVENDA']) {
    test(`${operacao} conta`, () => {
      assert.deepEqual([vendeuCom(operacao), comprouCom(operacao)], [true, true])
    })
  }

  test('na devolução de venda só consignação e transferência ficam fora', () => {
    assert.equal(devolveuCom('DEVOLUÇÃO DE CONSIGNAÇÃO'), false)
    assert.equal(devolveuCom('DEVOLUÇÃO POR TRANSFERÊNCIA'), false)
    assert.equal(devolveuCom('DEVOLUÇÃO DE VENDA'), true)
    assert.equal(devolveuCom('DEVOLUÇÃO DE VENDA COM SERVIÇO'), true)
    assert.equal(devolveuCom('DEVOLUÇÃO DE BONIFICAÇÃO'), true)
  })
})
