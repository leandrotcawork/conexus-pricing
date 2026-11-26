import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { clienteCrawlee } from './http.ts'
import { buscar, get, OPCOES, resumo } from './http-de-teste.ts'
import { abrirLojaDeTeste, escutar, fecharServidor } from './loja-de-teste.ts'

describe('Retry-After', () => {
  for (const status of [429, 503]) {
    test(`${status} espera os segundos pedidos e tenta uma vez`, async () => {
      await using loja = await abrirLojaDeTeste((_, vez) =>
        vez === 1 ? { status, cabecalhos: { 'retry-after': '1' } } : { status: 200 },
      )
      const resultados = await buscar([get(loja.url('/a'))])
      assert.deepEqual(resumo(resultados), ['RESPONDEU 200'])
      const [primeira, segunda] = loja.pedidos
      assert.ok(primeira && segunda && loja.pedidos.length === 2)
      assert.ok(segunda.em - primeira.em >= 950)
    })
  }

  test('em data HTTP também espera', async () => {
    await using loja = await abrirLojaDeTeste((_, vez) => {
      // a data HTTP tem resolução de um segundo
      const daqui = new Date(Date.now() + 2000).toUTCString()
      return vez === 1 ? { status: 429, cabecalhos: { 'retry-after': daqui } } : { status: 200 }
    })
    assert.deepEqual(resumo(await buscar([get(loja.url('/a'))])), ['RESPONDEU 200'])
    const [primeira, segunda] = loja.pedidos
    assert.ok(primeira && segunda && segunda.em - primeira.em >= 950)
  })

  test('uma espera maior que o teto é cortada no teto', async () => {
    await using loja = await abrirLojaDeTeste((_, vez) =>
      vez === 1 ? { status: 429, cabecalhos: { 'retry-after': '600' } } : { status: 200 },
    )
    const resultados = await buscar([get(loja.url('/a'))], { ...OPCOES, esperaMaximaMs: 300 })
    assert.deepEqual(resumo(resultados), ['RESPONDEU 200'])
    const [primeira, segunda] = loja.pedidos
    assert.ok(primeira && segunda && segunda.em - primeira.em >= 280)
  })

  test('um 429 que persiste falha visível depois de uma espera', async () => {
    await using loja = await abrirLojaDeTeste(() => ({
      status: 429,
      cabecalhos: { 'retry-after': '1' },
    }))
    assert.deepEqual(resumo(await buscar([get(loja.url('/a'))])), ['FALHOU 429'])
    assert.equal(loja.pedidos.length, 2)
  })
})

describe('falhas', () => {
  test('403 falha sem repetir', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 403 }))
    const resultados = await buscar([get(loja.url('/a'))])
    assert.deepEqual(resumo(resultados), ['FALHOU 403'])
    assert.equal(loja.pedidos.length, 1)
  })

  test('outros 4xx chegam a quem pediu, com o corpo', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 404, corpo: 'nada aqui' }))
    const [resultado] = await buscar([get(loja.url('/a'))])
    assert.ok(resultado?.tipo === 'RESPONDEU')
    assert.equal(resultado.resposta.status, 404)
    assert.equal(resultado.resposta.corpo, 'nada aqui')
  })

  test('loja que não responde no prazo falha sem status', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200, atrasoMs: 3000 }))
    const opcoes = { ...OPCOES, tentativas: 0, prazoPedidoMs: 500 }
    assert.deepEqual(resumo(await buscar([get(loja.url('/a'))], opcoes)), ['FALHOU null'])
  })

  test('certificado que não se confirma é recusado', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'precos-tls-'))
    after(() => rmSync(pasta, { recursive: true, force: true }))
    const [chave, certificado] = [join(pasta, 'chave.pem'), join(pasta, 'certificado.pem')]
    const pedido = '-x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1'.split(' ')
    execFileSync('openssl', ['req', ...pedido, '-keyout', chave, '-out', certificado], {
      stdio: 'ignore',
    })
    const tls = { key: readFileSync(chave), cert: readFileSync(certificado) }
    const servidor = createServer(tls, (_, resposta) => resposta.end('ok'))
    const porta = await escutar(servidor)
    const opcoes = { ...OPCOES, tentativas: 0 }
    const [resultado] = await buscar([get(`https://127.0.0.1:${porta}/a`)], opcoes)
    await fecharServidor(servidor)
    assert.ok(resultado?.tipo === 'FALHOU')
    assert.match(resultado.detalhe, /self.signed certificate/i)
  })
})

describe('uma loja, uma conexão, uma identidade', () => {
  test('um pedido em voo, na ordem dada, com o mesmo User-Agent mesmo após 403', async () => {
    await using loja = await abrirLojaDeTeste(({ caminho }) => ({
      status: caminho === '/3' ? 403 : 200,
    }))
    // mais que os 50 usos em que o Crawlee trocaria a sessão por padrão
    const caminhos = Array.from({ length: 60 }, (_, indice) => `/${indice}`)
    const resultados = await buscar(caminhos.map((caminho) => get(loja.url(caminho))))
    assert.equal(resumo(resultados).filter((r) => r === 'RESPONDEU 200').length, 59)
    assert.deepEqual(
      loja.pedidos.map((p) => p.caminho),
      caminhos,
    )
    assert.equal(loja.maximoEmVoo(), 1)
    assert.equal(new Set(loja.pedidos.map((p) => p.cabecalhos['user-agent'])).size, 1)
  })

  test('chamadas seguidas e simultâneas não se misturam', async () => {
    await using loja = await abrirLojaDeTeste(({ caminho }) => ({ status: 200, corpo: caminho }))
    const duasVezes = [get(loja.url('/a')), get(loja.url('/a'))]
    const chamadas = [
      await buscar(duasVezes),
      ...(await Promise.all([buscar(duasVezes), buscar([get(loja.url('/b'))])])),
    ]
    const corpos = chamadas.map((resultados) =>
      resultados.map((r) => (r?.tipo === 'RESPONDEU' ? r.resposta.corpo : r?.tipo)),
    )
    assert.deepEqual(corpos, [['/a', '/a'], ['/a', '/a'], ['/b']])
    assert.equal(loja.pedidos.length, 5)
  })

  test('POST leva o corpo e os cabeçalhos pedidos', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const corpo = JSON.stringify({ consulta: 'açaí' })
    await buscar([
      {
        url: loja.url('/graphql'),
        metodo: 'POST',
        cabecalhos: { 'content-type': 'application/json', 'x-loja': 'teste' },
        corpo,
      },
    ])
    const [recebido] = loja.pedidos
    assert.equal(recebido?.metodo, 'POST')
    assert.equal(recebido.cabecalhos['x-loja'], 'teste')
    assert.equal(await recebido.corpo, corpo)
  })

  test('um erro de quem consome para a fila e sobe, sem repetir o pedido', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const chamada = clienteCrawlee(OPCOES).buscar(
      [get(loja.url('/a')), get(loja.url('/b'))],
      async () => {
        throw new Error('banco fora')
      },
    )
    await assert.rejects(chamada, /banco fora/)
    assert.deepEqual(
      loja.pedidos.map((p) => p.caminho),
      ['/a'],
    )
  })
})

describe('uma identidade por cliente, em todas as chamadas', () => {
  test('chamadas seguidas mantêm o navegador e os cookies', async () => {
    await using loja = await abrirLojaDeTeste(({ caminho }) =>
      caminho === '/0'
        ? { status: 200, cabecalhos: { 'set-cookie': 'visita=1; Path=/' } }
        : { status: 200 },
    )
    const cliente = clienteCrawlee(OPCOES)
    for (let chamada = 0; chamada < 8; chamada++) {
      await cliente.buscar([get(loja.url(`/${chamada}`))], async () => undefined)
    }
    assert.equal(loja.pedidos.length, 8)
    assert.equal(new Set(loja.pedidos.map((p) => p.cabecalhos['user-agent'])).size, 1)
    assert.deepEqual(
      loja.pedidos.map((p) => p.cabecalhos.cookie),
      [undefined, ...Array.from({ length: 7 }, () => 'visita=1')],
    )
  })

  test('o mesmo pedido é feito de novo numa segunda chamada', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const cliente = clienteCrawlee(OPCOES)
    const respondidos: number[] = []
    for (let chamada = 0; chamada < 2; chamada++) {
      await cliente.buscar([get(loja.url('/a'))], async (indice) => {
        respondidos.push(indice)
      })
    }
    assert.deepEqual(respondidos, [0, 0])
    assert.equal(loja.pedidos.length, 2)
  })

  test('uma segunda chamada ao mesmo tempo é recusada', async () => {
    await using loja = await abrirLojaDeTeste(() => ({ status: 200 }))
    const cliente = clienteCrawlee(OPCOES)
    const primeira = cliente.buscar([get(loja.url('/a'))], async () => undefined)
    await assert.rejects(
      cliente.buscar([get(loja.url('/b'))], async () => undefined),
      /já está numa chamada/,
    )
    await primeira
  })
})

describe('teto de bytes por resposta', () => {
  const teto = { ...OPCOES, tetoBytes: 1000 }
  const latim = { 'content-type': 'application/json; charset=ISO-8859-1' }
  const casos = [
    { nome: 'corpo grande', roteada: { status: 200, corpo: 'a'.repeat(1001) } },
    {
      nome: 'corpo comprimido pequeno que descomprime grande',
      roteada: {
        status: 200,
        cabecalhos: { ...latim, 'content-encoding': 'gzip' },
        corpo: gzipSync('a'.repeat(200_000)),
      },
    },
    { nome: 'corpo grande de um erro 500', roteada: { status: 500, corpo: 'a'.repeat(5000) } },
  ]

  for (const { nome, roteada } of casos) {
    test(`${nome} falha sem repetir`, async () => {
      await using loja = await abrirLojaDeTeste(() => roteada)
      const [resultado] = await buscar([get(loja.url('/a'))], teto)
      assert.ok(resultado?.tipo === 'FALHOU')
      assert.match(resultado.detalhe, /teto de 1000 bytes/)
      assert.equal(loja.pedidos.length, 1)
    })
  }

  test('um corpo no limite chega inteiro, descomprimido e em UTF-8', async () => {
    const corpo = 'ç'.repeat(1000)
    await using loja = await abrirLojaDeTeste(() => ({
      status: 200,
      cabecalhos: { ...latim, 'content-encoding': 'gzip' },
      corpo: gzipSync(Buffer.from(corpo, 'latin1')),
    }))
    const [resultado] = await buscar([get(loja.url('/a'))], teto)
    assert.ok(resultado?.tipo === 'RESPONDEU')
    assert.equal(resultado.resposta.corpo, corpo)
  })
})
