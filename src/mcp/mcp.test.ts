import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { abrirBancoDeLeitura, EAN_REPETIDO } from '../banco/leituras-de-teste.ts'
import { configDoMcp, urlDoBancoDeTeste } from '../config.ts'
import { criarFuncaoMcp } from '../funcoes/mcp.ts'
import { conectar, ENDERECO, TOKEN } from '../funcoes/mcp-de-teste.ts'

const SEM_BANCO = 'postgres://ninguem:nada@127.0.0.1:1/nada'

const Pagina = z.object({
  produtos: z.array(z.looseObject({ codprod: z.string() })),
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
  return Pagina.parse(await mcp.responder('buscar_produto', argumentos))
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

describe('quem entra', () => {
  const funcao = criarFuncaoMcp({ urlDoBanco: SEM_BANCO, token: TOKEN })

  const recusados = [
    ['sem cabeçalho', {}],
    ['com outro token', { authorization: `Bearer ${TOKEN.replace('0', '1')}` }],
    ['com o token e mais um caractere', { authorization: `Bearer ${TOKEN}0` }],
    ['com o começo do token', { authorization: `Bearer ${TOKEN.slice(0, -1)}` }],
    ['com o token sem Bearer', { authorization: TOKEN }],
  ] as const

  for (const [nome, headers] of recusados) {
    test(`${nome}: 401`, async () => {
      for (const method of ['GET', 'POST']) {
        const resposta = await funcao.fetch(new Request(ENDERECO, { method, headers }))
        assert.equal(resposta.status, 401)
        assert.equal(resposta.headers.get('www-authenticate'), 'Bearer')
      }
    })
  }

  test('o cliente MCP não conecta sem token', async () => {
    await assert.rejects(conectar(SEM_BANCO, { token: null }))
  })

  test('fora de /mcp não há nada, nem com token: 404', async () => {
    for (const caminho of ['/', '/mcp/', '/outra', '/telhanorte']) {
      const headers = { authorization: `Bearer ${TOKEN}` }
      const pedido = new Request(new URL(caminho, ENDERECO), { headers })
      assert.equal((await funcao.fetch(pedido)).status, 404)
    }
  })

  test('a função não sobe com token curto, com espaço ou ausente, e não o repete', () => {
    for (const token of [undefined, 'curto-demais', `${'x'.repeat(40)} y`]) {
      assert.throws(
        () => configDoMcp({ LEITOR_DATABASE_URL: SEM_BANCO, MCP_TOKEN: token }),
        (erro: Error) => erro.message.includes('MCP_TOKEN') && !erro.message.includes('curto-'),
      )
    }
    const config = configDoMcp({ LEITOR_DATABASE_URL: SEM_BANCO, MCP_TOKEN: TOKEN })
    assert.equal(config.token, TOKEN)
  })
})

describe('o que o agente vê', () => {
  test('as quatro ferramentas, com título, descrição e os dois esquemas', () => {
    const nomes = mcp.ferramentas.map(({ name }) => name)
    assert.deepEqual(nomes, [
      'buscar_produto',
      'precos_atuais',
      'estatisticas_preco',
      'saude_coleta',
    ])
    for (const { title, description, inputSchema, outputSchema } of mcp.ferramentas) {
      assert.ok(title && description)
      assert.equal(inputSchema.type, 'object')
      assert.equal(outputSchema?.type, 'object')
    }
  })

  test('um cliente do protocolo de 2026-07-28 também é atendido', async () => {
    const moderno = await conectar(banco.urlDoLeitor, {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    })
    assert.equal(moderno.cliente.getNegotiatedProtocolVersion(), '2026-07-28')
    await moderno.responder('saude_coleta', {})
    await moderno.cliente.close()
  })

  test('com o banco fora, a ferramenta erra sem repetir a consulta', async () => {
    const semBanco = await conectar(SEM_BANCO)
    const { erro, texto } = await semBanco.chamar('saude_coleta', {})
    assert.deepEqual([erro, texto], [true, 'não consegui ler o banco de preços; tente de novo'])
    await semBanco.cliente.close()
  })
})

describe('buscar_produto', () => {
  test('devolve o produto com o nosso preço em reais', async () => {
    assert.deepEqual(await mcp.responder('buscar_produto', { codprod: '101' }), {
      produtos: [
        {
          codprod: '101',
          ean: '2000000000011',
          descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
          marca: 'MARCA ALFA',
          referenciaFabricante: 'REF-101',
          nossoPreco: 100,
        },
      ],
      continuacao: null,
    })
  })

  const buscas = [
    ['texto sem acento acha o acentuado', { texto: 'chuveiro eletrico' }, ['102']],
    ['texto com acento acha o sem acento', { texto: 'ELÉTRIC' }, ['101', '102']],
    ['as palavras valem em qualquer ordem', { texto: 'teste   torneira' }, ['101']],
    ['% vale como texto', { texto: '100%' }, ['102']],
    ['_ vale como texto', { texto: '10_' }, []],
    ['marca ignora a caixa', { marca: 'alfa' }, ['101']],
    ['EAN repetido traz os dois', { ean: EAN_REPETIDO }, ['103', '105']],
    ['os filtros valem juntos', { texto: 'teste', marca: 'beta' }, ['102']],
    ['nada encontrado é lista vazia', { texto: 'inexistente' }, []],
  ] as const

  for (const [nome, argumentos, esperados] of buscas) {
    test(nome, async () => {
      assert.deepEqual(await codigos(argumentos), esperados)
    })
  }
})

describe('as páginas de buscar_produto', () => {
  test('são de 20, sem repetir nem pular, e a última não continua', async () => {
    const paginas = await percorrer({ marca: 'paginada' })
    assert.deepEqual(paginas, [sequencia(201, 20), sequencia(221, 20), sequencia(241, 5)])
  })

  test('com a conta exata de duas páginas, não há terceira vazia', async () => {
    const paginas = await percorrer({ texto: 'quarenta' })
    assert.deepEqual(paginas, [sequencia(201, 20), sequencia(221, 20)])
  })

  test('a continuação de outra busca, ou inventada, é recusada', async () => {
    const { continuacao } = await pagina({ marca: 'paginada' })
    assert.ok(continuacao)
    for (const argumentos of [
      { texto: 'cabo', continuacao },
      { marca: 'paginada', continuacao: 'inventada' },
    ]) {
      const { erro, texto } = await mcp.chamar('buscar_produto', argumentos)
      assert.equal(erro, true)
      assert.match(texto, /continuação inválida/)
    }
  })
})

describe('o que é recusado', () => {
  const invalidas = [
    ['buscar_produto', {}],
    ['buscar_produto', { continuacao: 'x' }],
    ['buscar_produto', { texto: ' a ' }],
    ['buscar_produto', { ean: '20000000000AB' }],
    ['precos_atuais', {}],
    ['precos_atuais', { produto: {} }],
    ['precos_atuais', { produto: { codprod: '101', ean: '2000000000011' } }],
    ['estatisticas_preco', { produto: { codprod: '101' }, dias: 6 }],
    ['estatisticas_preco', { produto: { codprod: '101' }, dias: 366 }],
    ['saude_coleta', { loja: 'Nao Existe' }],
  ] as const

  for (const [ferramenta, argumentos] of invalidas) {
    test(`${ferramenta} com ${JSON.stringify(argumentos)}`, async () => {
      const { erro, texto } = await mcp.chamar(ferramenta, argumentos)
      assert.equal(erro, true)
      assert.match(texto, /Input validation error/)
    })
  }

  for (const ferramenta of ['precos_atuais', 'estatisticas_preco']) {
    test(`${ferramenta} de um produto inexistente erra com a frase`, async () => {
      for (const produto of [{ codprod: '999' }, { ean: '2000000099999' }]) {
        const { erro, texto, saida } = await mcp.chamar(ferramenta, { produto })
        assert.deepEqual([erro, texto, saida], [true, 'produto não encontrado', undefined])
      }
    })

    test(`${ferramenta} com um EAN de dois produtos pede o codprod`, async () => {
      const argumentos = { produto: { ean: EAN_REPETIDO } }
      const { erro, texto } = await mcp.chamar(ferramenta, argumentos)
      assert.equal(erro, true)
      assert.match(texto, /codprod 103, 105/)
    })
  }

  test('saude_coleta de uma loja que não existe erra, e não devolve vazio', async () => {
    const { erro, texto } = await mcp.chamar('saude_coleta', { loja: 'leroy' })
    assert.deepEqual([erro, texto], [true, 'loja não encontrada'])
  })
})
