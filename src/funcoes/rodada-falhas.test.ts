import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { A, abrirBancoDeRodada, B, RESERVA, SEM_PRODUTO } from '../banco/rodadas-de-teste.ts'
import { fonte } from '../banco/tabelas.ts'
import { comGravacao } from '../coleta/loja-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { cortaOLote, entrega, HOJE, montar } from './rodada-de-teste.ts'

const SEMANA_QUE_VEM = '2026-12-07T06:00:00Z'

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

describe('quando a loja não responde direito', () => {
  test('o lote inválido é refeito um a um, com aviso', async () => {
    await using montada = await montar(banco.urlDoColetor, cortaOLote)
    const { corpo } = await montada.disparar('telhanorte')
    const motivo = 'resposta cortada: 1 de 2'
    assert.partialDeepStrictEqual(corpo, { situacao: 'CONCLUIDA' })
    assert.deepEqual(corpo.avisos, [{ tipo: 'LOTE_REFEITO_UM_A_UM', eans: 3, motivo }])
    assert.deepEqual(await montada.eansPedidos(), [[A, B, SEM_PRODUTO], [A], [B], [SEM_PRODUTO]])
    const gravadas = (await banco.observacoes()).map((o) => o.situacao)
    assert.deepEqual(gravadas, ['OK', 'OK', 'NAO_ENCONTRADO', 'OK'])
  })

  test('falha da loja vira ERRO com o detalhe e a contagem, nunca preço', async () => {
    await using montada = await montar(banco.urlDoColetor, () => ({ status: 500 }))
    const { status, corpo } = await montada.disparar('condec')
    assert.equal(status, 200)
    assert.partialDeepStrictEqual(corpo, { contagens: { OK: 0, ERRO: 4 } })
    for (const { situacao, preco, detalhe } of await banco.observacoes()) {
      assert.deepEqual([situacao, preco], ['ERRO', null])
      assert.match(detalhe ?? '', /500/)
    }
    const [lote, umAUm, vezes] = [1, 3, 2]
    assert.equal(montada.loja.pedidos.length, (lote + umAUm) * vezes)
  })

  test('o 403 num EAN só não derruba os outros', async () => {
    await using montada = await montar(banco.urlDoColetor, (pedido) =>
      pedido.caminho.includes(B) ? { status: 403 } : comGravacao(pedido),
    )
    await montada.disparar('condec')
    assert.deepEqual(await banco.situacoes(), [
      ['1', 'OK', 5090],
      ['2', 'ERRO', null],
      ['3', 'NAO_ENCONTRADO', null],
      ['4', 'OK', 5090],
    ])
  })

  test('com a home da ABC fora, a rodada usa o token reserva e avisa', async () => {
    await using montada = await montar(banco.urlDoColetor, (pedido) =>
      pedido.metodo === 'GET' ? { status: 500 } : comGravacao(pedido),
    )
    const { corpo } = await montada.disparar('abc')
    assert.partialDeepStrictEqual(corpo, { situacao: 'CONCLUIDA' })
    assert.deepEqual(corpo.avisos, [{ tipo: 'TOKEN_RESERVA_EM_USO' }])
    const consulta = montada.loja.pedidos.find((p) => p.metodo === 'POST')
    assert.equal(consulta?.cabecalhos['tcs-access-token'], RESERVA)
  })

  test('menos da metade dos OK da rodada anterior fecha como SUSPEITA', async () => {
    let virada = Number.POSITIVE_INFINITY
    await using montada = await montar(banco.urlDoColetor, (pedido) =>
      comGravacao(pedido, pedido.em > virada ? 'vazio' : 'lote'),
    )
    await montada.disparar('telhanorte', HOJE)
    virada = performance.now()
    const { corpo } = await montada.disparar('telhanorte', SEMANA_QUE_VEM)
    assert.partialDeepStrictEqual(corpo, { situacao: 'SUSPEITA' })
    assert.deepEqual(corpo.avisos, [{ tipo: 'QUEDA_DE_OK', anterior: 3, atual: 0 }])
    const gravadas = (await banco.rodadas()).map((r) => r.situacao)
    assert.deepEqual(gravadas, ['CONCLUIDA', 'SUSPEITA'])
  })
})

describe('a ABC sem token reserva na config', () => {
  beforeEach(async () => {
    const semReserva = sql`${fonte.config} - 'tokenReserva'`
    await banco.dono.update(fonte).set({ config: semReserva }).where(eq(fonte.codigo, 'abc'))
  })

  test('com o token na home, a rodada usa esse token e não avisa', async () => {
    await using montada = await montar(banco.urlDoColetor)
    const { status, corpo } = await montada.disparar('abc')
    assert.equal(status, 200)
    assert.partialDeepStrictEqual(corpo, { situacao: 'CONCLUIDA' })
    assert.deepEqual(corpo.avisos, [])
    const consulta = montada.loja.pedidos.find((p) => p.metodo === 'POST')
    assert.equal(consulta?.cabecalhos['tcs-access-token'], 'tcs_inventado_00000000000000000000')
  })

  test('com a home fora, 500 e rodada FALHOU com o motivo, sem pedir os lotes', async () => {
    await using montada = await montar(banco.urlDoColetor, (pedido) =>
      pedido.metodo === 'GET' ? { status: 500 } : comGravacao(pedido),
    )
    const { status, corpo } = await montada.disparar('abc')
    const motivo = 'sem token de vitrine na home da loja e sem tokenReserva na config'
    assert.equal(status, 500)
    assert.partialDeepStrictEqual(corpo, { tipo: 'PREPARO_FALHOU', motivo })
    assert.partialDeepStrictEqual(await banco.rodadas(), [
      { situacao: 'FALHOU', avisos: [{ tipo: 'PREPARO_FALHOU', motivo }] },
    ])
    assert.ok(montada.loja.pedidos.every((p) => p.metodo === 'GET'))
    assert.deepEqual(await banco.observacoes(), [])
  })
})

/** Um bloco no fio: os lotes, e depois cada EAN dos lotes recusados sozinho. */
function blocoRecusado(...lotes: number[]) {
  const eans = lotes.reduce((total, lote) => total + lote, 0)
  return [...lotes, ...Array.from({ length: eans }, () => 1)]
}

describe('um catálogo maior que um bloco', () => {
  test('cada bloco de 150 EANs vai um a um antes de o bloco seguinte começar', async () => {
    await using _ = await banco.crescerCatalogo(200)
    await using montada = await montar(banco.urlDoColetor, cortaOLote)
    await montada.disparar('telhanorte')
    const tamanhos = (await montada.eansPedidos()).map((eans) => eans?.length)
    assert.deepEqual(tamanhos, [...blocoRecusado(50, 50, 50), ...blocoRecusado(50, 3)])
    assert.equal((await banco.observacoes()).length, 204)
  })
})

describe('o que não roda', () => {
  test('sem o cabeçalho do gatilho: 401, sem pedido e sem rodada', async () => {
    await using montada = await montar(banco.urlDoColetor)
    const resposta = await montada.funcao.fetch(entrega('telhanorte', HOJE, {}))
    assert.equal(resposta.status, 401)
    assert.equal(montada.loja.pedidos.length, 0)
    assert.equal((await banco.rodadas()).length, 0)
  })

  test('envelope inválido: 400', async () => {
    await using montada = await montar(banco.urlDoColetor)
    for (const corpo of ['', '{}', '{"version":2}']) {
      const pedido = new Request('https://funcao.teste/telhanorte', {
        method: 'POST',
        headers: { 'x-neon-trigger-invocation-id': 'entrega-1' },
        body: corpo,
      })
      assert.equal((await montada.funcao.fetch(pedido)).status, 400)
    }
    assert.equal((await banco.rodadas()).length, 0)
  })

  for (const codigo of ['leroy', 'Nao-Existe']) {
    test(`loja desconhecida (${codigo}): 404`, async () => {
      await using montada = await montar(banco.urlDoColetor)
      const { status, corpo } = await montada.disparar(codigo)
      assert.deepEqual([status, corpo.tipo], [404, 'FONTE_DESCONHECIDA'])
    })
  }

  test('loja inativa: 200 sem pedido e sem rodada', async () => {
    await banco.dono.update(fonte).set({ ativa: false }).where(eq(fonte.codigo, 'condec'))
    await using montada = await montar(banco.urlDoColetor)
    const { status, corpo } = await montada.disparar('condec')
    assert.deepEqual([status, corpo.tipo], [200, 'FONTE_INATIVA'])
    assert.equal(montada.loja.pedidos.length, 0)
    assert.equal((await banco.rodadas()).length, 0)
  })

  test('config inválida: 500, rodada FALHOU com o motivo, e retomada depois do conserto', async () => {
    const curta = JSON.stringify({ tokenReserva: 'curto' })
    const comReservaCurta = sql`${fonte.config} || ${curta}::jsonb`
    await banco.dono.update(fonte).set({ config: comReservaCurta }).where(eq(fonte.codigo, 'abc'))
    await using montada = await montar(banco.urlDoColetor)
    const { status, corpo } = await montada.disparar('abc')
    const motivo = 'config inválida em tokenReserva'
    assert.equal(status, 500)
    assert.partialDeepStrictEqual(corpo, { tipo: 'CONFIG_INVALIDA', motivo })
    assert.partialDeepStrictEqual(await banco.rodadas(), [
      { situacao: 'FALHOU', avisos: [{ tipo: 'CONFIG_INVALIDA', motivo }] },
    ])
    assert.equal(montada.loja.pedidos.length, 0)

    await banco.darTokenReservaAAbc()
    assert.equal((await montada.disparar('abc')).status, 200)
    const [consertada] = await banco.rodadas()
    assert.equal(consertada?.situacao, 'CONCLUIDA')
    // o histórico da rodada fica: houve uma entrega com a config errada
    assert.deepEqual(consertada.avisos, [{ tipo: 'CONFIG_INVALIDA', motivo }])
  })
})
