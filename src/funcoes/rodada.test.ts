import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { A, abrirBancoDeRodada, CATALOGO, SEM_PRODUTO } from '../banco/rodadas-de-teste.ts'
import { comGravacao } from '../coleta/loja-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { cortaOLote, HOJE, montar } from './rodada-de-teste.ts'

let banco: Awaited<ReturnType<typeof abrirBancoDeRodada>>

before(async () => {
  banco = await abrirBancoDeRodada(urlDoBancoDeTeste())
})

beforeEach(async () => {
  await banco.limpar()
})

after(async () => {
  await banco.apagar()
})

describe('uma rodada de cada loja', () => {
  const lojas = [
    { codigo: 'telhanorte', precoA: 2090, precoB: 1090, listaA: 2090, cadastrosA: 1, pedidos: 1 },
    { codigo: 'condec', precoA: 5090, precoB: 2090, listaA: 6090, cadastrosA: 2, pedidos: 1 },
    { codigo: 'abc', precoA: 2090, precoB: 1090, listaA: 2090, cadastrosA: 1, pedidos: 2 },
  ]

  for (const { codigo, precoA, precoB, listaA, cadastrosA, pedidos } of lojas) {
    test(`${codigo} grava uma observação por produto e fecha a rodada`, async () => {
      await using montada = await montar(banco.urlDoColetor)
      const contagens = { OK: 3, SEM_ESTOQUE: 0, SEM_PRECO: 0, NAO_ENCONTRADO: 1, ERRO: 0 }
      const concluida = { situacao: 'CONCLUIDA', contagens }
      const { status, corpo } = await montada.disparar(codigo)
      assert.equal(status, 200)
      assert.partialDeepStrictEqual(corpo, { tipo: 'FECHADA', ...concluida })
      assert.deepEqual(corpo.avisos, [])
      assert.deepEqual(await banco.situacoes(), [
        ['1', 'OK', precoA],
        ['2', 'OK', precoB],
        ['3', 'NAO_ENCONTRADO', null],
        ['4', 'OK', precoA],
      ])
      const [primeira] = await banco.observacoes()
      assert.deepEqual([primeira?.precoLista, primeira?.cadastros], [listaA, cadastrosA])
      const [gravada] = await banco.rodadas()
      assert.partialDeepStrictEqual(gravada, { ...concluida, versao: 'e3' })
      assert.ok(gravada?.concluidaEm)
      assert.deepEqual(gravada.avisos, [])
      assert.equal(montada.loja.pedidos.length, pedidos)
    })
  }
})

describe('a mesma rodada entregue outra vez', () => {
  test('concluída não reabre, não pede nada e não duplica', async () => {
    await using montada = await montar(banco.urlDoColetor)
    await montada.disparar('telhanorte')
    const antes = await banco.rodadas()
    const segunda = await montada.disparar('telhanorte')
    assert.equal(segunda.status, 200)
    assert.equal(segunda.corpo.tipo, 'JA_CONCLUIDA')
    assert.deepEqual(await banco.rodadas(), antes)
    assert.equal((await banco.observacoes()).length, 4)
    assert.equal(montada.loja.pedidos.length, 1)
  })

  test('duas entregas ao mesmo tempo: uma roda, a outra volta depois', async () => {
    await using montada = await montar(banco.urlDoColetor, (pedido) => ({
      ...comGravacao(pedido),
      atrasoMs: 300,
    }))
    const respostas = await Promise.all([
      montada.disparar('telhanorte'),
      montada.disparar('telhanorte'),
    ])
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 503])
    const recusada = respostas.find((r) => r.status === 503)
    assert.equal(recusada?.corpo.tipo, 'EM_ANDAMENTO')
    assert.equal(recusada.reentregarEm, '900')
    assert.equal((await banco.rodadas()).length, 1)
    assert.equal(montada.loja.pedidos.length, 1)
  })

  test('a que ainda dá sinal não é tomada', async () => {
    await banco.deixarRodando({ agendadaPara: HOJE, minutosSemSinal: 14 })
    await using montada = await montar(banco.urlDoColetor)
    const { status, corpo } = await montada.disparar('telhanorte')
    assert.deepEqual([status, corpo.tipo], [503, 'EM_ANDAMENTO'])
    assert.equal(montada.loja.pedidos.length, 0)
  })

  test('a órfã é retomada, e só o que falta é perguntado', async () => {
    await banco.deixarRodando({ agendadaPara: HOJE, minutosSemSinal: 16 })
    await using montada = await montar(banco.urlDoColetor)
    const { status, corpo } = await montada.disparar('telhanorte')
    assert.deepEqual([status, corpo.situacao], [200, 'CONCLUIDA'])
    assert.deepEqual(await montada.eansPedidos(), [[A, SEM_PRODUTO]])
    assert.deepEqual(await banco.situacoes(), [
      ['1', 'OK', 2090],
      ['2', 'SEM_PRECO', null],
      ['3', 'NAO_ENCONTRADO', null],
      ['4', 'OK', 2090],
    ])
    assert.partialDeepStrictEqual(await banco.rodadas(), [{ versao: 'e3' }])
  })
})

describe('o prazo da rodada', () => {
  test('o que não coube fica de fora, e a nova entrega completa sem repetir', async () => {
    const [atrasoMs, prazoMs] = [600, 1500]
    await using curta = await montar(
      banco.urlDoColetor,
      (pedido, vez) => ({ ...cortaOLote(pedido, vez), atrasoMs }),
      prazoMs,
    )
    const primeira = await curta.disparar('telhanorte')
    assert.deepEqual(
      [primeira.status, primeira.corpo.tipo, primeira.reentregarEm],
      [503, 'INTERROMPIDA', '900'],
    )
    const gravadas = (await banco.observacoes()).length
    assert.ok(gravadas > 0 && gravadas < 4, String(gravadas))
    const [interrompida] = await banco.rodadas()
    assert.equal(interrompida?.situacao, 'INTERROMPIDA')
    assert.partialDeepStrictEqual(interrompida.avisos.at(-1), {
      tipo: 'PRAZO_ESGOTADO',
      faltaram: 4 - gravadas,
    })

    const jaGravados = new Set((await banco.observacoes()).map((o) => o.codprod))
    const faltantes = CATALOGO.filter(([codprod]) => !jaGravados.has(codprod)).map(([, ean]) => ean)

    await using completa = await montar(banco.urlDoColetor)
    const segunda = await completa.disparar('telhanorte')
    assert.deepEqual([segunda.status, segunda.corpo.situacao], [200, 'CONCLUIDA'])
    assert.equal((await banco.observacoes()).length, 4)
    assert.deepEqual(await completa.eansPedidos(), [[...new Set(faltantes)]])
    // os avisos explicam o que a primeira tentativa gravou, e continuam na rodada concluída
    const finais = await banco.rodadas()
    assert.deepEqual(
      finais.map((r) => r.avisos.map((aviso) => aviso.tipo)),
      [['LOTE_REFEITO_UM_A_UM', 'PRAZO_ESGOTADO']],
    )
  })

  test('prazo vencido antes do preparo: nada é pedido e a rodada volta depois', async () => {
    await using montada = await montar(banco.urlDoColetor, undefined, -1)
    const { corpo } = await montada.disparar('abc')
    assert.equal(corpo.tipo, 'INTERROMPIDA')
    assert.equal(montada.loja.pedidos.length, 0)
  })
})
