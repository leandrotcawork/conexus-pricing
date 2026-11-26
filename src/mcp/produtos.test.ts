import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { abrirBancoDeLeitura, EAN_101, EAN_REPETIDO } from '../banco/leituras-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { conectar } from '../funcoes/mcp-de-teste.ts'

const Pagina = z.object({
  produtos: z.array(z.looseObject({ codprod: z.string() })),
  naoEncontrados: z.array(z.string()),
  continuacao: z.string().nullable(),
})

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

async function pagina(argumentos: Record<string, unknown>) {
  return Pagina.parse(await mcp.responder('buscar_produtos', argumentos))
}

async function codigos(argumentos: Record<string, unknown>) {
  return (await pagina(argumentos)).produtos.map(({ codprod }) => codprod)
}

async function percorrer(argumentos: Record<string, unknown>) {
  const paginas: string[][] = []
  let continuacao: string | null = null
  do {
    const lida: z.infer<typeof Pagina> = await pagina({
      ...argumentos,
      ...(continuacao === null ? {} : { continuacao }),
    })
    paginas.push(lida.produtos.map(({ codprod }) => codprod))
    continuacao = lida.continuacao
  } while (continuacao !== null)
  return paginas
}

function sequencia(de: number, quantos: number) {
  return Array.from({ length: quantos }, (_, indice) => String(de + indice))
}

describe('buscar_produtos', () => {
  test('devolve o produto com o grupo pelo caminho e o nosso preço em reais', async () => {
    assert.deepEqual(await mcp.responder('buscar_produtos', { codprods: ['101'] }), {
      produtos: [
        {
          codprod: '101',
          ean: EAN_101,
          descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
          marca: 'MARCA ALFA',
          grupo: { codigo: 12, caminho: 'Revestimentos > Porcelanatos > Polidos' },
          nossoPreco: 100,
        },
      ],
      naoEncontrados: [],
      continuacao: null,
    })
  })

  test('um lote de 50 traz cada um uma vez, e o que não existe não derruba o lote', async () => {
    const pedidos = ['999', ...sequencia(201, 48), '201']
    const lida = await pagina({ codprods: pedidos })
    assert.deepEqual(
      lida.produtos.map(({ codprod }) => codprod),
      sequencia(201, 48),
    )
    assert.deepEqual([lida.naoEncontrados, lida.continuacao], [['999'], null])
  })

  test('um lote de EANs traz os dois produtos do EAN repetido e conta o que falta', async () => {
    const lida = await pagina({ eans: [EAN_REPETIDO, EAN_101, '2000000099999'] })
    assert.deepEqual(
      lida.produtos.map(({ codprod }) => codprod),
      ['101', '103', '105'],
    )
    assert.deepEqual(lida.naoEncontrados, ['2000000099999'])
  })

  const buscas = [
    ['texto sem acento acha o acentuado', { texto: 'chuveiro eletrico' }, ['102']],
    ['texto com acento acha o sem acento', { texto: 'ELÉTRIC' }, ['101', '102']],
    ['as palavras valem em qualquer ordem', { texto: 'teste   torneira' }, ['101']],
    ['% vale como texto', { texto: '100%' }, ['102']],
    ['_ vale como texto', { texto: '10_' }, []],
    ['marca ignora a caixa', { marca: 'alfa' }, ['101']],
    ['os filtros valem juntos', { texto: 'teste', marca: 'beta' }, ['102']],
    ['a lista e o texto valem juntos', { codprods: ['101', '102'], texto: 'chuveiro' }, ['102']],
    ['nada encontrado é lista vazia', { texto: 'inexistente' }, []],
    ['o grupo traz os subgrupos, até o último nível', { grupo: 10 }, ['101', '102', '103']],
    ['um grupo do meio traz o que é dele e o de dentro', { grupo: 11 }, ['101', '102']],
    ['um grupo folha traz só o dele', { grupo: 13 }, ['103']],
    ['um grupo sem produto é lista vazia', { grupo: 30 }, []],
    ['o grupo vale junto com a marca', { grupo: 10, marca: 'beta' }, ['102']],
  ] as const

  for (const [nome, argumentos, esperados] of buscas) {
    test(nome, async () => {
      assert.deepEqual(await codigos(argumentos), esperados)
    })
  }
})

describe('as páginas de buscar_produtos', () => {
  test('são de 50, sem repetir nem pular, e a última não continua', async () => {
    const paginas = await percorrer({ marca: 'paginada' })
    assert.deepEqual(paginas, [sequencia(201, 50), sequencia(251, 50), sequencia(301, 20)])
  })

  test('com a conta exata de duas páginas, não há terceira vazia', async () => {
    const paginas = await percorrer({ texto: 'centena' })
    assert.deepEqual(paginas, [sequencia(201, 50), sequencia(251, 50)])
  })

  test('a continuação de outra busca, ou inventada, é recusada', async () => {
    const { continuacao } = await pagina({ marca: 'paginada' })
    assert.ok(continuacao)
    for (const argumentos of [
      { texto: 'cabo', continuacao },
      { marca: 'paginada', continuacao: 'inventada' },
    ]) {
      const { erro, texto } = await mcp.chamar('buscar_produtos', argumentos)
      assert.equal(erro, true)
      assert.match(texto, /continuação inválida/)
    }
  })
})

function grupo(codigo: number, nome: string, pai: number | null, contagens: [number, number]) {
  const [produtos, comPrecoDeConcorrente] = contagens
  return { codigo, nome, pai, produtos, comPrecoDeConcorrente }
}

describe('grupos_produto', () => {
  test('soma os subgrupos, só traz grupo com produto e ordena pelo caminho', async () => {
    assert.deepEqual(await mcp.responder('grupos_produto', {}), {
      grupos: [
        grupo(20, 'Hidráulica', null, [1, 0]),
        grupo(10, 'Revestimentos', null, [3, 3]),
        grupo(13, 'Azulejos', 10, [1, 1]),
        grupo(11, 'Porcelanatos', 10, [2, 2]),
        grupo(12, 'Polidos', 11, [1, 1]),
      ],
    })
  })

  test('com dentroDe, só os subgrupos dele', async () => {
    assert.deepEqual(await mcp.responder('grupos_produto', { dentroDe: 11 }), {
      grupos: [grupo(12, 'Polidos', 11, [1, 1])],
    })
    assert.deepEqual(await mcp.responder('grupos_produto', { dentroDe: 12 }), { grupos: [] })
  })
})
