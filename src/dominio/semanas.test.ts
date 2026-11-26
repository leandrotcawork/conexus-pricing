import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FonteCodigo } from './marcas.ts'
import { semanaDe, serieSemanal } from './semanas.ts'

function rodada(loja: string, instante: string) {
  return { loja: FonteCodigo.parse(`loja${loja}`), agendadaPara: new Date(instante), instante }
}

describe('a semana', () => {
  test('vai de segunda a domingo em UTC', () => {
    const segunda = semanaDe(new Date('2026-11-23T00:00:00Z'))
    assert.equal(semanaDe(new Date('2026-11-29T23:59:59Z')), segunda)
    assert.equal(semanaDe(new Date('2026-11-22T23:59:59Z')), segunda - 1)
    assert.equal(semanaDe(new Date('2026-11-30T00:00:00Z')), segunda + 1)
  })
})

describe('a série semanal', () => {
  test('vale a rodada mais nova de cada loja em cada semana', () => {
    const serie = serieSemanal([
      rodada('a', '2026-11-09T10:00:00Z'),
      rodada('a', '2026-11-23T10:00:00Z'),
      rodada('a', '2026-11-25T10:00:00Z'),
      rodada('b', '2026-11-11T10:00:00Z'),
    ])
    function instantes(rodadas: readonly { instante: string }[]) {
      return rodadas.map(({ instante }) => instante).toSorted()
    }
    assert.equal(serie.semanasComColeta, 2)
    // a loja b não rodou na semana mais nova: a última dela continua sendo a atual
    assert.deepEqual(instantes(serie.atuais), ['2026-11-11T10:00:00Z', '2026-11-25T10:00:00Z'])
    assert.deepEqual(instantes(serie.anteriores), ['2026-11-09T10:00:00Z'])
    assert.deepEqual(
      serie.janela.map(({ rodadas }) => instantes(rodadas)),
      [['2026-11-09T10:00:00Z', '2026-11-11T10:00:00Z'], ['2026-11-25T10:00:00Z']],
    )
  })

  test('a janela guarda as 8 semanas mais novas, a mais antiga primeiro', () => {
    const rodadas = Array.from({ length: 10 }, (_, indice) =>
      rodada('a', new Date(Date.UTC(2026, 8, 7 + indice * 7)).toISOString()),
    )
    const { janela, semanasComColeta } = serieSemanal(rodadas)
    assert.equal(semanasComColeta, 10)
    const semanas = janela.map(({ semana }) => semana)
    assert.equal(semanas.length, 8)
    assert.deepEqual(
      semanas,
      semanas.toSorted((a, b) => a - b),
    )
    assert.equal(semanas.at(-1), semanaDe(new Date(Date.UTC(2026, 10, 9))))
  })

  test('sem rodada não há semana nem rodada', () => {
    const vazia = { semanasComColeta: 0, atuais: [], anteriores: [], janela: [] }
    assert.deepEqual(serieSemanal([]), vazia)
  })
})
