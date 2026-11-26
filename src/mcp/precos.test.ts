import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { abrirBancoDeLeitura, EAN_101, EAN_REPETIDO } from '../banco/leituras-de-teste.ts'
import { abrirLoteCheio } from '../banco/semente-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { conectar } from '../funcoes/mcp-de-teste.ts'

let banco: Awaited<ReturnType<typeof abrirBancoDeLeitura>>
let mcp: Awaited<ReturnType<typeof conectar>>

before(async () => {
  banco = await abrirBancoDeLeitura(urlDoBancoDeTeste())
  mcp = await conectar(banco.urlDoLeitor)
})

after(async () => {
  await mcp.cliente.close()
  await banco.apagar()
})

const Precos = z.object({
  produtos: z.array(
    z.object({
      codprod: z.string(),
      lojas: z.array(z.looseObject({ loja: z.string(), situacao: z.string() })),
    }),
  ),
  naoEncontrados: z.array(z.string()),
})

const Saude = z.object({
  lojas: z.array(
    z.object({
      loja: z.string(),
      nome: z.string(),
      ativa: z.boolean(),
      cobertura: z.object({ catalogo: z.number(), ok: z.number() }),
      ultimaRodada: z.looseObject({ idadeHoras: z.number() }).nullable(),
    }),
  ),
})

async function precos(argumentos: Record<string, unknown>) {
  return Precos.parse(await mcp.responder('precos_atuais', argumentos))
}

function loja(codigo: string, situacao: string, preco: number | null) {
  return { loja: codigo, situacao, preco, precoLista: null, promocao: null }
}

function rodada(codigo: string, nome: string, dias: number, situacao: string) {
  return { loja: codigo, nome, agendadaPara: banco.haDias(dias), situacao }
}

describe('precos_atuais', () => {
  test('traz a rodada de cada loja uma vez e, por produto, o que ela viu', async () => {
    const pedido = { produtos: [{ ean: EAN_101 }] }
    assert.deepEqual(await mcp.responder('precos_atuais', pedido), {
      rodadas: [
        rodada('abc', 'ABC da Construção', 3, 'SUSPEITA'),
        // a rodada FALHOU de dois dias atrás não substitui a de nove
        rodada('condec', 'Condec', 9, 'CONCLUIDA'),
        // nem a que ainda está rodando
        rodada('telhanorte', 'Telha Norte', 2, 'CONCLUIDA'),
      ],
      lojasSemColeta: ['nova'],
      produtos: [
        {
          codprod: '101',
          descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
          nossoPreco: 100,
          lojas: [
            loja('abc', 'SEM_ESTOQUE', 1),
            loja('condec', 'OK', 120.01),
            { ...loja('telhanorte', 'OK', 80), precoLista: 85, promocao: 0.0588 },
          ],
        },
      ],
      naoEncontrados: [],
    })
  })

  test('URL, vendedor, motivo e hora só vêm com detalhes', async () => {
    const lido = await precos({ produtos: [{ codprod: '101' }], detalhes: true })
    assert.partialDeepStrictEqual(lido.produtos[0]?.lojas[2], {
      detalhes: {
        vendedor: 'Vendedor Inventado',
        url: 'https://loja.teste/101',
        detalhe: null,
        coletadoEm: banco.haDias(2),
      },
    })
    const comErro = await precos({ produtos: [{ codprod: '102' }], detalhes: true })
    assert.partialDeepStrictEqual(comErro.produtos[0]?.lojas[1], {
      detalhes: { detalhe: 'HTTP 500' },
    })
  })

  test('a loja que não vende é distinta da coleta que falhou', async () => {
    const [produto] = (await precos({ produtos: [{ codprod: '102' }] })).produtos
    assert.deepEqual(
      produto?.lojas.map((l) => [l.loja, l.situacao, l.preco]),
      [
        ['abc', 'OK', 15],
        ['condec', 'ERRO', null],
        ['telhanorte', 'NAO_ENCONTRADO', null],
      ],
    )
  })

  test('o produto que nenhuma rodada perguntou vem sem lojas', async () => {
    const lido = await precos({ produtos: [{ codprod: '104' }] })
    assert.deepEqual(lido.produtos, [{ codprod: '104', lojas: [] }])
  })
})

describe('precos_atuais em lote', () => {
  test('segue a ordem do pedido, sem repetir, e o inexistente não derruba o lote', async () => {
    const produtos = [
      { codprod: '102' },
      { codprod: '999' },
      { ean: EAN_REPETIDO },
      { codprod: '101' },
      { ean: EAN_101 },
      { codprod: '103' },
      { ean: '2000000099999' },
    ]
    const lido = await precos({ produtos })
    assert.deepEqual(
      lido.produtos.map(({ codprod }) => codprod),
      ['102', '103', '105', '101'],
    )
    assert.deepEqual(lido.naoEncontrados, ['999', '2000000099999'])
  })

  test('um lote em que nada existe responde, com tudo em naoEncontrados', async () => {
    const lido = await precos({ produtos: [{ codprod: '999' }] })
    assert.deepEqual(lido, { produtos: [], naoEncontrados: ['999'] })
  })
})

describe('o tamanho de um lote cheio, com todas as lojas das migrações', () => {
  let cheio: Awaited<ReturnType<typeof abrirLoteCheio>>
  let doCheio: Awaited<ReturnType<typeof conectar>>

  before(async () => {
    cheio = await abrirLoteCheio(urlDoBancoDeTeste())
    doCheio = await conectar(cheio.urlDoLeitor)
  })

  after(async () => {
    await doCheio.cliente.close()
    await cheio.apagar()
  })

  test('precos_atuais de 50 produtos cabe abaixo de 50 mil caracteres', async () => {
    const { erro, texto } = await doCheio.chamar('precos_atuais', { produtos: cheio.produtos })
    assert.equal(erro, false)
    const lidos = Precos.parse(JSON.parse(texto)).produtos
    assert.equal(lidos.length, 50)
    assert.ok(lidos.every(({ lojas }) => lojas.length === cheio.lojas.length))
    assert.ok(texto.length < 50_000, `${texto.length} caracteres`)
  })

  test('panorama_precos de 50 produtos cabe abaixo de 50 mil caracteres', async () => {
    const escopo = { produtos: cheio.produtos }
    const { erro, texto } = await doCheio.chamar('panorama_precos', { escopo, limite: 50 })
    assert.equal(erro, false)
    assert.ok(texto.length < 50_000, `${texto.length} caracteres`)
  })
})

function contagens(outras: Record<string, number>) {
  return { OK: 0, SEM_ESTOQUE: 0, SEM_PRECO: 0, NAO_ENCONTRADO: 0, ERRO: 0, ...outras }
}

describe('saude_coleta', () => {
  test('mostra a última rodada de cada loja em qualquer situação', async () => {
    const { lojas } = Saude.parse(await mcp.responder('saude_coleta', {}))
    assert.deepEqual(
      lojas.map(({ loja, ativa }) => [loja, ativa]),
      [
        ['abc', true],
        ['antiga', false],
        ['condec', true],
        ['nova', true],
        ['telhanorte', true],
      ],
    )
    const [abc, , condec, nova, telhanorte] = lojas
    assert.partialDeepStrictEqual(abc?.ultimaRodada, {
      situacao: 'SUSPEITA',
      agendadaPara: banco.haDias(3),
      concluidaEm: banco.haDias(3),
      contagens: contagens({ OK: 2, SEM_ESTOQUE: 1, NAO_ENCONTRADO: 120 }),
      avisos: [
        'os produtos com preço caíram de 10 para 2',
        'a coleta usou o token reserva da loja, porque não achou o token na home',
      ],
    })
    assert.partialDeepStrictEqual(condec?.ultimaRodada, {
      situacao: 'FALHOU',
      contagens: contagens({ ERRO: 1 }),
      avisos: ['nenhum produto voltou com preço, e 1 deram erro'],
    })
    assert.equal(nova?.ultimaRodada, null)
    assert.partialDeepStrictEqual(telhanorte?.ultimaRodada, {
      situacao: 'RODANDO',
      concluidaEm: null,
      contagens: contagens({ OK: 1 }),
    })
    // três dias desde o fecho; um dia desde o início da que roda
    assert.equal(Math.round(abc?.ultimaRodada?.idadeHoras ?? 0), 72)
    assert.equal(Math.round(telhanorte?.ultimaRodada?.idadeHoras ?? 0), 24)
  })

  test('a cobertura conta o OK da última rodada com preços, não o da que falhou', async () => {
    const { lojas } = Saude.parse(await mcp.responder('saude_coleta', {}))
    assert.deepEqual(
      lojas.map(({ loja, cobertura }) => [loja, cobertura.ok, cobertura.catalogo]),
      [
        ['abc', 2, 125],
        ['antiga', 1, 125],
        // as de nove dias atrás: a FALHOU de depois não conta
        ['condec', 122, 125],
        ['nova', 0, 125],
        // a rodada em andamento também não
        ['telhanorte', 122, 125],
      ],
    )
  })

  test('uma loja só, quando pedida', async () => {
    const { lojas } = Saude.parse(await mcp.responder('saude_coleta', { loja: 'condec' }))
    assert.deepEqual(
      lojas.map(({ loja }) => loja),
      ['condec'],
    )
  })
})
