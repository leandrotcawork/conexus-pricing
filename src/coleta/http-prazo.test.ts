import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { clienteCrawlee } from './http.ts'
import { buscar, get, OPCOES, resumo } from './http-de-teste.ts'
import { abrirLojaDeTeste } from './loja-de-teste.ts'

describe('ritmo por minuto', () => {
  test('o ritmo por minuto vale entre pedidos, na mesma chamada e na seguinte', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    // 120 por minuto: um pedido começa meio segundo depois do anterior
    const cliente = clienteCrawlee({ ...OPCOES, porMinuto: 120 })
    for (const caminhos of [['/aquece'], ['/a', '/b'], ['/c']]) {
      const pedidos = caminhos.map((caminho) => get(loja.url(caminho)))
      await cliente.buscar(pedidos, async () => undefined)
    }
    // o primeiro pedido de um cliente demora a sair, e a loja o vê atrasado
    const chegadas = loja.pedidos.slice(1).map((p) => p.em)
    const folgas = chegadas.slice(1).map((em, indice) => em - (chegadas[indice] ?? 0))
    assert.equal(folgas.length, 2)
    assert.ok(
      folgas.every((folga) => folga >= 400),
      `folgas em ms: ${folgas.map(Math.round).join(', ')}`,
    )
  })
})

function ate(ms: number) {
  return { ...OPCOES, prazoFinal: new Date(Date.now() + ms) }
}

describe('prazo final', () => {
  test('nenhum pedido começa depois do prazo, e o que sobrou não vira resposta', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200, atrasoMs: 150 }))
    const pedidos = Array.from({ length: 30 }, (_, indice) => get(loja.url(`/${indice}`)))
    const limite = performance.now() + 600
    const resultados = await buscar(pedidos, ate(600))
    assert.ok(loja.pedidos.length >= 1 && loja.pedidos.length < 10)
    assert.ok(loja.pedidos.every((p) => p.em <= limite + 20))
    assert.equal(resultados.filter((r) => r !== undefined).length, loja.pedidos.length)
  })

  test('com o prazo vencido nada é pedido', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    assert.deepEqual(resumo(await buscar([get(loja.url('/a'))], ate(-1))), ['sem resposta'])
    assert.equal(loja.pedidos.length, 0)
  })

  test('com o processo preso além do prazo, o pedido seguinte não sai nem vira falha', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const opcoes = ate(300)
    const respondidos: number[] = []
    const pedidos = [get(loja.url('/a')), get(loja.url('/b'))]
    await clienteCrawlee(opcoes).buscar(pedidos, async (indice) => {
      respondidos.push(indice)
      // segura o processo inteiro além do prazo: nenhum temporizador toca nesse intervalo
      const espera = Math.max(0, opcoes.prazoFinal.getTime() - Date.now()) + 20
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera)
    })
    assert.equal(loja.pedidos.length, 1)
    assert.deepEqual(respondidos, [0])
  })

  test('a espera do limite por minuto não passa do prazo', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const pedidos = Array.from({ length: 5 }, (_, indice) => get(loja.url(`/${indice}`)))
    const inicio = performance.now()
    await buscar(pedidos, { ...ate(800), porMinuto: 2 })
    assert.ok(performance.now() - inicio < 5000)
    assert.equal(loja.pedidos.length, 1)
  })

  test('um Retry-After além do prazo não é esperado nem repetido', async () => {
    await using loja = await abrirLojaDeTeste(() => ({
      status: 429,
      cabecalhos: { 'retry-after': '600' },
    }))
    const inicio = performance.now()
    const resultados = await buscar([get(loja.url('/a'))], ate(500))
    assert.ok(performance.now() - inicio < 5000)
    assert.deepEqual(resumo(resultados), ['sem resposta'])
    assert.equal(loja.pedidos.length, 1)
  })
})

describe('a pausa do Retry-After vale para o cliente', () => {
  test('depois de um Retry-After além do prazo, nada mais sai para a loja no mesmo cliente', async () => {
    await using loja = await abrirLojaDeTeste((pedido) =>
      pedido.caminho === '/a'
        ? { status: 429, cabecalhos: { 'retry-after': '600' } }
        : { status: 200 },
    )
    const cliente = clienteCrawlee(ate(5000))
    const respondidos: string[] = []
    for (const caminhos of [['/a', '/b'], ['/c'], ['/d', '/e']]) {
      const pedidos = caminhos.map((caminho) => get(loja.url(caminho)))
      await cliente.buscar(pedidos, async (indice) => {
        respondidos.push(caminhos[indice] ?? '')
      })
    }
    assert.deepEqual(
      loja.pedidos.map((p) => p.caminho),
      ['/a'],
    )
    assert.deepEqual(respondidos, [])
  })

  test('o Retry-After além do prazo na última tentativa também segura as chamadas seguintes', async () => {
    await using loja = await abrirLojaDeTeste((pedido, vez) => {
      if (pedido.caminho !== '/a') return { status: 200 }
      return { status: 429, cabecalhos: { 'retry-after': vez === 1 ? '1' : '600' } }
    })
    const cliente = clienteCrawlee(ate(5000))
    for (const caminhos of [['/a'], ['/c'], ['/d']]) {
      const pedidos = caminhos.map((caminho) => get(loja.url(caminho)))
      await cliente.buscar(pedidos, async () => undefined)
    }
    assert.deepEqual(
      loja.pedidos.map((p) => p.caminho),
      ['/a', '/a'],
    )
  })

  test('a pausa que cabe no prazo é esperada antes da chamada seguinte', async () => {
    await using loja = await abrirLojaDeTeste((pedido) =>
      pedido.caminho === '/a'
        ? { status: 429, cabecalhos: { 'retry-after': '1' } }
        : { status: 200 },
    )
    const cliente = clienteCrawlee(OPCOES)
    for (const caminhos of [['/a'], ['/b']]) {
      const pedidos = caminhos.map((caminho) => get(loja.url(caminho)))
      await cliente.buscar(pedidos, async () => undefined)
    }
    const [, ultimoA, b] = loja.pedidos
    assert.deepEqual(
      loja.pedidos.map((p) => p.caminho),
      ['/a', '/a', '/b'],
    )
    assert.ok(
      ultimoA && b && b.em - ultimoA.em >= 900,
      `folga: ${b && ultimoA && b.em - ultimoA.em}`,
    )
  })
})
