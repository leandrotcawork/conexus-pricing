import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { abrirHistorico, abrirUmaSemana } from '../banco/panorama-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { conectar } from '../funcoes/mcp-de-teste.ts'

const Linha = z.looseObject({ chave: z.string(), nome: z.string() })

const Panorama = z.object({
  semanasComColeta: z.number(),
  historico: z.string().nullable(),
  total: z.looseObject({ mudancas: z.unknown(), tendencia: z.unknown() }),
  linhas: z.array(Linha),
  naoEncontrados: z.array(z.string()),
  continuacao: z.string().nullable(),
})

let banco: Awaited<ReturnType<typeof abrirUmaSemana>>
let mcp: Awaited<ReturnType<typeof conectar>>

before(async () => {
  banco = await abrirUmaSemana(urlDoBancoDeTeste())
  mcp = await conectar(banco.urlDoLeitor)
})

after(async () => {
  await mcp.cliente.close()
  await banco.apagar()
})

async function panorama(argumentos: Record<string, unknown>, cliente = mcp) {
  return Panorama.parse(await cliente.responder('panorama_precos', argumentos))
}

const TODOS = { escopo: { catalogo: true } }

async function chaves(argumentos: Record<string, unknown>) {
  return (await panorama(argumentos)).linhas.map(({ chave }) => chave)
}

type Valores = {
  readonly cobertura: [produtos: number, comPreco: number]
  readonly indice?: number
  readonly ponderado?: number
  readonly gap?: number
  readonly menor?: number
  readonly amplitude?: number
  readonly emPromocao?: number
  readonly ruptura?: number
}

function indicadores(valores: Valores) {
  const [produtos, comPreco] = valores.cobertura
  return {
    cobertura: { produtos, comPreco },
    indice: valores.indice ?? null,
    indicePonderado: valores.ponderado ?? null,
    gapMenorPct: valores.gap ?? null,
    menorPrecoPct: valores.menor ?? null,
    amplitudePct: valores.amplitude ?? null,
    emPromocao: valores.emPromocao ?? 0,
    rupturaPct: valores.ruptura ?? null,
    mudancas: null,
    tendencia: null,
  }
}

function linha(chave: string, nome: string, valores: Valores, posicao: string | null = null) {
  return { chave, nome, posicao, ...indicadores(valores) }
}

const PISO_UM = {
  indice: 100,
  ponderado: 100,
  gap: 10,
  menor: 0,
  amplitude: 20,
  emPromocao: 1,
  ruptura: 0,
}
const PISO_DOIS = { indice: 80, ponderado: 80, gap: -20, menor: 100, ruptura: 50 }

describe('panorama_precos com uma semana de coleta', () => {
  test('o total e cada produto saem com os indicadores calculados à mão', async () => {
    assert.deepEqual(await panorama(TODOS), {
      semanasComColeta: 1,
      historico:
        'ainda não há semanas suficientes: mudanças pedem 4 semanas de coleta e a tendência pede 8; há 1',
      // índice (100 + 80) / 2; ponderado (100×300 + 80×100) / 400; ruptura 1 de 6 com OK ou SEM_ESTOQUE
      total: indicadores({
        cobertura: [4, 3],
        indice: 90,
        ponderado: 95,
        gap: -5,
        menor: 50,
        amplitude: 20,
        emPromocao: 1,
        ruptura: 16.67,
      }),
      linhas: [
        linha('1', 'PISO UM', { cobertura: [1, 1], ...PISO_UM }, 'NA_FAIXA'),
        linha('2', 'PISO DOIS', { cobertura: [1, 1], ...PISO_DOIS }, 'MAIS_BARATO'),
        linha('3', 'TUBO SEM PRECO NOSSO', { cobertura: [1, 1], ruptura: 0 }),
        linha('4', 'AVULSO', { cobertura: [1, 0] }),
      ],
      naoEncontrados: [],
      continuacao: null,
    })
  })

  test('por grupo, cada produto fica no seu grupo, com o caminho como nome', async () => {
    const { linhas } = await panorama({ ...TODOS, agruparPor: 'grupo' })
    assert.deepEqual(linhas, [
      linha('20', 'Hidráulica', { cobertura: [1, 1], ruptura: 0 }),
      linha('10', 'Revestimentos', { cobertura: [1, 1], ...PISO_UM }),
      linha('11', 'Revestimentos > Porcelanatos', { cobertura: [1, 1], ...PISO_DOIS }),
      linha('', 'Sem grupo', { cobertura: [1, 0] }),
    ])
  })

  test('por marca, a linha agrega os produtos dela', async () => {
    const { linhas } = await panorama({ ...TODOS, agruparPor: 'marca' })
    assert.deepEqual(linhas, [
      linha('ALFA', 'ALFA', { cobertura: [2, 2], ...PISO_UM }),
      linha('BETA', 'BETA', { cobertura: [1, 1], ...PISO_DOIS }),
      linha('', 'Sem marca', { cobertura: [1, 0] }),
    ])
  })
})

describe('panorama_precos por loja', () => {
  test('compara o nosso preço só com a loja, e o menor preço é entre as lojas', async () => {
    const { linhas } = await panorama({ ...TODOS, agruparPor: 'loja' })
    assert.deepEqual(linhas, [
      linha('abc', 'ABC da Construção', {
        cobertura: [4, 3],
        indice: 95,
        ponderado: 102.5,
        gap: -5,
        menor: 100,
        emPromocao: 1,
        ruptura: 0,
      }),
      linha('condec', 'Condec', {
        cobertura: [4, 1],
        indice: 100,
        ponderado: 100,
        gap: 0,
        menor: 0,
        ruptura: 50,
      }),
      linha('telhanorte', 'Telha Norte', {
        cobertura: [4, 1],
        indice: 91.67,
        ponderado: 91.67,
        gap: -8.33,
        menor: 0,
        ruptura: 0,
      }),
    ])
  })

  test('ordenarPor vai do maior para o menor', async () => {
    const pedido = { ...TODOS, agruparPor: 'loja', ordenarPor: 'gapMenorPct' }
    assert.deepEqual(await chaves(pedido), ['condec', 'abc', 'telhanorte'])
  })

  test('quem não tem o indicador fica no fim', async () => {
    const pedido = { ...TODOS, agruparPor: 'grupo', ordenarPor: 'indice' }
    assert.deepEqual(await chaves(pedido), ['10', '11', '20', ''])
  })
})

describe('o escopo e as páginas do panorama', () => {
  test('o grupo inclui os subgrupos', async () => {
    const lido = await panorama({ escopo: { grupo: 10 } })
    assert.deepEqual(
      lido.linhas.map(({ chave }) => chave),
      ['1', '2'],
    )
    assert.partialDeepStrictEqual(lido.total, { indice: 90, cobertura: { produtos: 2 } })
  })

  test('a marca é a inteira e ignora a caixa', async () => {
    assert.deepEqual(await chaves({ escopo: { marca: 'alfa' } }), ['1', '3'])
    assert.deepEqual(await chaves({ escopo: { marca: 'alf' } }), [])
  })

  test('na lista de produtos, o inexistente não derruba os outros', async () => {
    const produtos = [{ codprod: '2' }, { codprod: '999' }]
    const lido = await panorama({ escopo: { produtos } })
    assert.deepEqual(
      lido.linhas.map(({ chave }) => chave),
      ['2'],
    )
    assert.deepEqual(lido.naoEncontrados, ['999'])
  })

  test('as páginas não repetem nem pulam, e o total é do escopo inteiro', async () => {
    const primeira = await panorama({ ...TODOS, limite: 3 })
    assert.ok(primeira.continuacao)
    const segunda = await panorama({ ...TODOS, limite: 3, continuacao: primeira.continuacao })
    assert.deepEqual(
      [...primeira.linhas, ...segunda.linhas].map(({ chave }) => chave),
      ['1', '2', '3', '4'],
    )
    assert.deepEqual(segunda.total, primeira.total)
    assert.equal(segunda.continuacao, null)
  })

  test('a continuação de outro pedido é recusada', async () => {
    const { continuacao } = await panorama({ ...TODOS, limite: 1 })
    const outro = { ...TODOS, ordenarPor: 'indice', continuacao }
    const { erro, texto } = await mcp.chamar('panorama_precos', outro)
    assert.equal(erro, true)
    assert.match(texto, /continuação inválida/)
  })
})

describe('o histórico do panorama', () => {
  let historico: Awaited<ReturnType<typeof abrirHistorico>>
  let cliente: Awaited<ReturnType<typeof conectar>>

  before(async () => {
    historico = await abrirHistorico(urlDoBancoDeTeste())
    cliente = await conectar(historico.urlDoLeitor)
  })

  after(async () => {
    await cliente.cliente.close()
    await historico.apagar()
  })

  function semanas() {
    return panorama(TODOS, cliente)
  }
  const MUDANCAS = { subiram: 1, desceram: 1, tamanhoMedioPct: 25 }
  const SO_TENDENCIA = 'ainda não há semanas suficientes: a tendência pede 8 semanas de coleta; há'

  test('mudanças pedem 4 semanas, a tendência 8, e a repetida na semana não conta', async () => {
    await historico.gravarSemanas([6, 7, 8])
    await historico.gravarRepetida(8)
    const comTres = await semanas()
    assert.equal(comTres.semanasComColeta, 3)
    assert.deepEqual([comTres.total.mudancas, comTres.total.tendencia], [null, null])
    assert.match(comTres.historico ?? '', /mudanças pedem 4 semanas.*há 3$/)

    await historico.gravarSemanas([5])
    const comQuatro = await semanas()
    assert.deepEqual([comQuatro.total.mudancas, comQuatro.total.tendencia], [MUDANCAS, null])
    assert.equal(comQuatro.historico, `${SO_TENDENCIA} 4`)

    await historico.gravarSemanas([2, 3, 4])
    const comSete = await semanas()
    assert.deepEqual([comSete.total.tendencia, comSete.historico], [null, `${SO_TENDENCIA} 7`])

    await historico.gravarSemanas([1])
    const comOito = await semanas()
    assert.deepEqual([comOito.semanasComColeta, comOito.historico], [8, null])
    // o índice vai de 100 a 125: +25% entre as metades; inclinação 200/42 sobre a média 112,5
    assert.deepEqual(comOito.total.tendencia, { variacaoPct: 25, inclinacaoPctSemana: 4.23 })
    assert.deepEqual(comOito.total.mudancas, MUDANCAS)
  })

  test('uma coleta nova invalida a continuação', async () => {
    const { continuacao } = await panorama({ ...TODOS, limite: 1 }, cliente)
    await historico.gravarSemanas([9])
    const pedido = { ...TODOS, limite: 1, continuacao }
    const { erro, texto } = await cliente.chamar('panorama_precos', pedido)
    assert.equal(erro, true)
    assert.match(texto, /continuação inválida/)
  })
})
