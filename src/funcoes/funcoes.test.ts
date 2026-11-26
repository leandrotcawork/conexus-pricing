import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { criarBancoDescartavel } from '../banco/descartavel.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { criarFuncaoColeta } from './coleta.ts'

const SEM_BANCO = 'postgres://ninguem:nada@127.0.0.1:1/nada'

let descartavel: Awaited<ReturnType<typeof criarBancoDescartavel>>

before(async () => {
  descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
  await descartavel.migrar()
})

after(async () => {
  await descartavel.apagar()
})

async function responder(url: string, pedido: Request) {
  const resposta = await criarFuncaoColeta({ urlDoBanco: url }).fetch(pedido)
  return { status: resposta.status, corpo: await resposta.json() }
}

function pergunta() {
  return new Request('https://funcao.teste/')
}

describe('estou de pé', () => {
  test('coleta responde pela role precos_coletor', async () => {
    assert.deepEqual(await responder(descartavel.urls.coletor, pergunta()), {
      status: 200,
      corpo: { dePe: true, role: 'precos_coletor', node: process.version },
    })
  })

  test('coleta não está de pé com outra role', async () => {
    for (const url of [descartavel.urls.leitor, descartavel.urls.dono]) {
      assert.deepEqual(await responder(url, pergunta()), {
        status: 503,
        corpo: { dePe: false, motivo: 'ROLE_ERRADA', node: process.version },
      })
    }
  })

  test('coleta não está de pé sem banco', async () => {
    assert.deepEqual(await responder(SEM_BANCO, pergunta()), {
      status: 503,
      corpo: { dePe: false, motivo: 'BANCO_INACESSIVEL', node: process.version },
    })
  })

  test('coleta não tem outras rotas', async () => {
    const outra = new Request('https://funcao.teste/telhanorte')
    const { status } = await responder(SEM_BANCO, outra)
    assert.equal(status, 404)
  })
})
