import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { criarBancoDescartavel } from '../banco/descartavel.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { criarFuncaoColeta } from './coleta.ts'
import { criarFuncaoMcp } from './mcp.ts'

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
  return criarFuncaoColeta({ urlDoBanco: url })
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
      const outra = new Request('https://funcao.teste/telhanorte')
      const { status } = await responder(criar(SEM_BANCO), outra)
      assert.equal(status, 404)
    })
  }
})
