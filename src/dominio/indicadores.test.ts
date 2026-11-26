import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Cotacao } from './indicadores.ts'
import {
  amplitude,
  arredondar,
  emPromocao,
  gapParaOMenor,
  indiceDePreco,
  mediana,
  mediaPonderada,
  mudancasDePreco,
  paresDePrecos,
  posicaoDe,
  rupturaPct,
  tendenciaDoIndice,
} from './indicadores.ts'
import { Centavos, FonteCodigo } from './marcas.ts'

function ok(loja: string, preco: number, precoLista: number | null = null): Cotacao {
  return {
    loja: FonteCodigo.parse(`loja${loja}`),
    situacao: 'OK',
    preco: Centavos.parse(preco),
    precoLista: precoLista === null ? null : Centavos.parse(precoLista),
  }
}

function sem(loja: string, situacao: Exclude<Cotacao['situacao'], 'OK'>): Cotacao {
  return { loja: FonteCodigo.parse(`loja${loja}`), situacao }
}

describe('o nosso preço contra as lojas', () => {
  test('a mediana é o preço do meio, ou a média dos dois do meio', () => {
    assert.equal(mediana([300, 100, 200]), 200)
    assert.equal(mediana([400, 100, 300, 200]), 250)
    assert.equal(mediana([]), null)
  })

  test('o índice é o nosso preço sobre a mediana, vezes 100', () => {
    assert.equal(indiceDePreco(216, [100, 200, 900]), 108)
    assert.equal(indiceDePreco(null, [100]), null)
    assert.equal(indiceDePreco(100, []), null)
  })

  test('o gap é quanto estamos acima ou abaixo do menor, em %', () => {
    assert.equal(gapParaOMenor(110, [100, 200]), 10)
    assert.equal(gapParaOMenor(80, [100, 200]), -20)
    assert.equal(gapParaOMenor(null, [100]), null)
    assert.equal(gapParaOMenor(100, []), null)
  })

  test('o empate com o menor conta como mais barato, e com o maior como mais caro', () => {
    assert.equal(posicaoDe(100, [100, 200]), 'MAIS_BARATO')
    assert.equal(posicaoDe(200, [100, 200]), 'MAIS_CARO')
    assert.equal(posicaoDe(150, [100, 200]), 'NA_FAIXA')
    assert.equal(posicaoDe(150, []), null)
  })

  test('a amplitude pede três lojas', () => {
    assert.equal(amplitude([100, 150]), null)
    assert.equal(amplitude([100, 150, 125]), 50)
  })

  test('a média ponderada ignora quem não tem peso, e é nula sem peso nenhum', () => {
    const itens = [
      { valor: 100, peso: 3 },
      { valor: 80, peso: 1 },
      { valor: 5000, peso: 0 },
    ]
    assert.equal(mediaPonderada(itens), 95)
    assert.equal(mediaPonderada([{ valor: 100, peso: 0 }]), null)
  })
})

describe('o que as lojas fazem', () => {
  test('promoção é preço OK abaixo do preço de lista', () => {
    const cotacoes = [ok('a', 90, 100), ok('b', 100, 100), ok('c', 100), sem('d', 'SEM_ESTOQUE')]
    assert.equal(emPromocao(cotacoes), 1)
  })

  test('a ruptura conta só as lojas que vendem o produto e mostraram o estoque', () => {
    const cotacoes = [ok('a', 1), sem('b', 'SEM_ESTOQUE'), sem('c', 'ERRO'), sem('d', 'SEM_PRECO')]
    assert.equal(rupturaPct(cotacoes), 50)
    const naoVendem = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((loja) =>
      sem(loja, 'NAO_ENCONTRADO'),
    )
    assert.equal(rupturaPct([sem('a', 'SEM_ESTOQUE'), ...naoVendem]), 100)
    assert.equal(rupturaPct([sem('a', 'ERRO'), sem('b', 'SEM_PRECO'), ...naoVendem]), null)
  })

  test('um par pede preço OK na mesma loja nas duas coletas', () => {
    const agora = [ok('a', 110), ok('b', 90), ok('c', 100), sem('d', 'ERRO')]
    const antes = [ok('a', 100), sem('b', 'SEM_ESTOQUE'), ok('d', 70)]
    assert.deepEqual(paresDePrecos(agora, antes), [{ antes: 100, agora: 110 }])
  })

  test('as mudanças contam quem subiu e desceu, com o tamanho médio só do que mudou', () => {
    const pares = [
      { antes: 100, agora: 110 },
      { antes: 200, agora: 140 },
      { antes: 50, agora: 50 },
    ]
    assert.deepEqual(mudancasDePreco(pares), { subiram: 1, desceram: 1, tamanhoMedioPct: 20 })
    const parados = { subiram: 0, desceram: 0, tamanhoMedioPct: null }
    assert.deepEqual(mudancasDePreco([{ antes: 50, agora: 50 }]), parados)
    assert.equal(mudancasDePreco([]), null)
  })
})

describe('a tendência', () => {
  function serie(indices: readonly number[]) {
    return indices.map((indice, semana) => ({ semana, indice }))
  }

  test('pede 8 semanas', () => {
    assert.equal(tendenciaDoIndice(serie([1, 2, 3, 4, 5, 6, 7])), null)
  })

  test('numa reta, a inclinação é o passo sobre a média, e a variação compara as metades', () => {
    const lida = tendenciaDoIndice(serie([100, 102, 104, 106, 108, 110, 112, 114]))
    assert.ok(lida)
    // metades: 103 → 111; passo 2 sobre a média 107
    assert.equal(arredondar(lida.variacaoPct), 7.77)
    assert.equal(arredondar(lida.inclinacaoPctSemana), 1.87)
  })

  test('usa as 8 semanas mais novas e o intervalo real entre elas', () => {
    const pontos = [
      { semana: 0, indice: 999 },
      ...[10, 11, 12, 13, 20, 21, 22, 23].map((semana) => ({ semana, indice: 100 + semana })),
    ]
    const lida = tendenciaDoIndice(pontos)
    assert.ok(lida)
    // média 116,5: inclinação de 1 ponto por semana, com um buraco de seis semanas no meio
    assert.equal(arredondar(lida.inclinacaoPctSemana, 4), arredondar(100 / 116.5, 4))
  })

  test('arredondar não devolve -0', () => {
    assert.ok(Object.is(arredondar(-0.001), 0))
  })
})
