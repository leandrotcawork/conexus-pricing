import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { criarBancoDescartavel } from '../banco/descartavel.ts'
import { abrirLojaDeTeste } from '../coleta/loja-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { criarFuncaoColeta } from './coleta.ts'
import { criarFuncaoMcp } from './mcp.ts'

const Alcances = z.object({ lojas: z.array(z.looseObject({ ms: z.number().nonnegative() })) })
const Consulta = z.object({ variables: z.unknown() })
const TOKEN = 'token-de-teste-com-mais-de-32-caracteres'
const EAN = '2000000000015'
const SEM_BANCO = 'postgres://ninguem:nada@127.0.0.1:1/nada'

let descartavel: Awaited<ReturnType<typeof criarBancoDescartavel>>

before(async () => {
  descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
  await descartavel.migrar()
})

after(async () => {
  await descartavel.apagar()
})

async function responder(funcao: { fetch(pedido: Request): Promise<Response> }, pedido: Request) {
  const resposta = await funcao.fetch(pedido)
  return { status: resposta.status, corpo: await resposta.json() }
}

function coleta(url: string) {
  return criarFuncaoColeta({ urlDoBanco: url, tokenDeAlcance: TOKEN })
}

function mcp(url: string) {
  return criarFuncaoMcp({ urlDoBanco: url })
}

function pergunta() {
  return new Request('https://funcao.teste/')
}

describe('estou de pé', () => {
  const casos = [
    { nome: 'coleta', criar: coleta, certa: 'coletor', errada: 'leitor' },
    { nome: 'mcp', criar: mcp, certa: 'leitor', errada: 'coletor' },
  ] as const

  for (const { nome, criar, certa, errada } of casos) {
    test(`${nome} responde pela role precos_${certa}`, async () => {
      assert.deepEqual(await responder(criar(descartavel.urls[certa]), pergunta()), {
        status: 200,
        corpo: { dePe: true, role: `precos_${certa}`, node: process.version },
      })
    })

    test(`${nome} não está de pé com outra role`, async () => {
      for (const url of [descartavel.urls[errada], descartavel.urls.dono]) {
        assert.deepEqual(await responder(criar(url), pergunta()), {
          status: 503,
          corpo: { dePe: false, motivo: 'ROLE_ERRADA', node: process.version },
        })
      }
    })

    test(`${nome} não está de pé sem banco`, async () => {
      assert.deepEqual(await responder(criar(SEM_BANCO), pergunta()), {
        status: 503,
        corpo: { dePe: false, motivo: 'BANCO_INACESSIVEL', node: process.version },
      })
    })

    test(`${nome} não tem outras rotas`, async () => {
      const outra = new Request('https://funcao.teste/telhanorte', { method: 'POST' })
      const { status } = await responder(criar(SEM_BANCO), outra)
      assert.equal(status, 404)
    })
  }
})

function alcance(corpo: unknown, autorizacao = `Bearer ${TOKEN}`) {
  return new Request('https://funcao.teste/_alcance', {
    method: 'POST',
    headers: autorizacao === '' ? {} : { authorization: autorizacao },
    body: JSON.stringify(corpo),
  })
}

async function lojasDeTeste() {
  const loja = await abrirLojaDeTeste(({ caminho }) => ({
    status: caminho.startsWith('/web_api') ? 403 : 200,
  }))
  const alvos = {
    telhanorte: loja.url('/'),
    condec: loja.url('/'),
    abc: { api: loja.url('/graphql'), loja: 'https://loja.teste/qualquer' },
  }
  const funcao = criarFuncaoColeta({ urlDoBanco: SEM_BANCO, tokenDeAlcance: TOKEN }, alvos)
  return { loja, funcao }
}

describe('alcance das lojas', () => {
  test('sem o token certo nada é pedido às lojas', async () => {
    const { loja, funcao } = await lojasDeTeste()
    await using _ = loja
    const corpo = { ean: EAN, tokenAbc: 'token-da-loja' }
    for (const autorizacao of ['', 'Bearer errado', TOKEN]) {
      const { status } = await responder(funcao, alcance(corpo, autorizacao))
      assert.equal(status, 401)
    }
    assert.equal(loja.pedidos.length, 0)
  })

  test('um corpo sem EAN válido ou sem token da loja é recusado', async () => {
    const { loja, funcao } = await lojasDeTeste()
    await using _ = loja
    for (const corpo of [null, { ean: EAN }, { ean: 'abc', tokenAbc: 'token-da-loja' }]) {
      assert.equal((await responder(funcao, alcance(corpo))).status, 400)
    }
    assert.equal(loja.pedidos.length, 0)
  })

  test('faz um pedido por loja e devolve status, tempo e a falha de cada uma', async () => {
    const { loja, funcao } = await lojasDeTeste()
    await using _ = loja
    const resposta = await responder(funcao, alcance({ ean: EAN, tokenAbc: 'token-da-loja' }))
    assert.equal(resposta.status, 200)
    const { lojas } = Alcances.parse(resposta.corpo)
    assert.deepEqual(
      lojas.map(({ ms, ...resto }) => resto),
      [
        { loja: 'telhanorte', status: 200 },
        { loja: 'condec', status: 403, falha: 'HTTP 403' },
        { loja: 'abc', status: 200 },
      ],
    )
    assert.deepEqual(loja.pedidos.map((p) => `${p.metodo} ${p.caminho}`).sort(), [
      `GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean%3A${EAN}&_from=0&_to=0`,
      `GET /web_api/products?ean=${EAN}&limit=50`,
      'POST /graphql',
    ])
    const wake = loja.pedidos.find((p) => p.metodo === 'POST')
    assert.equal(wake?.cabecalhos['tcs-access-token'], 'token-da-loja')
    assert.equal(wake.cabecalhos.origin, 'https://loja.teste')
    assert.deepEqual(Consulta.parse(JSON.parse(await wake.corpo)).variables, {
      eans: [EAN],
      n: 50,
    })
  })
})
