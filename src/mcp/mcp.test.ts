import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import { SkillsClient } from '@modelcontextprotocol/client/ext/skills'
import { abrirBancoDeLeitura } from '../banco/leituras-de-teste.ts'
import { configDoMcp, urlDoBancoDeTeste } from '../config.ts'
import { criarFuncaoMcp } from '../funcoes/mcp.ts'
import { conectar, ENDERECO, TOKEN } from '../funcoes/mcp-de-teste.ts'

const SEM_BANCO = 'postgres://ninguem:nada@127.0.0.1:1/nada'
const SKILL = new URL('../../skills/analise-precos/SKILL.md', import.meta.url)
const URI_DA_SKILL = 'skill://analise-precos/SKILL.md'

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
  test('as cinco ferramentas, com título, descrição e os dois esquemas', () => {
    const nomes = mcp.ferramentas.map(({ name }) => name)
    assert.deepEqual(nomes, [
      'buscar_produtos',
      'grupos_produto',
      'precos_atuais',
      'panorama_precos',
      'saude_coleta',
    ])
    for (const { title, description, inputSchema, outputSchema } of mcp.ferramentas) {
      assert.ok(title && description)
      assert.equal(inputSchema.type, 'object')
      assert.equal(outputSchema?.type, 'object')
    }
  })

  test('as instructions mandam carregar a skill e cabem no corte de 512 do Mastra', () => {
    const instrucoes = mcp.cliente.getInstructions() ?? ''
    assert.match(instrucoes, /carregue a skill analise-precos/)
    assert.ok(instrucoes.length <= 512, `${instrucoes.length} caracteres`)
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

describe('a skill servida pelo MCP', () => {
  const versoes = [
    ['2025', {}],
    ['2026-07-28', { versionNegotiation: { mode: { pin: '2026-07-28' } } }],
  ] as const

  for (const [versao, opcoes] of versoes) {
    test(`no protocolo de ${versao}, skills/list a lista e o SKILL.md confere`, async () => {
      const outro = await conectar(banco.urlDoLeitor, opcoes)
      const skills = new SkillsClient(outro.cliente)
      assert.equal(skills.supported, true)
      const { skills: listadas } = await skills.list()
      assert.deepEqual(
        listadas.map(({ uri, frontmatter }) => [uri, frontmatter.name]),
        [[URI_DA_SKILL, 'analise-precos']],
      )
      const [primeira] = listadas
      assert.ok(primeira)
      const lida = await skills.read(primeira)
      assert.equal(lida.verified, true)
      assert.equal(lida.text, await readFile(SKILL, 'utf8'))
      await outro.cliente.close()
    })
  }

  test('quem não fala a extensão a lê como recurso', async () => {
    const { contents } = await mcp.cliente.readResource({ uri: URI_DA_SKILL })
    const [conteudo] = contents
    assert.ok(conteudo && 'text' in conteudo)
    assert.equal(conteudo.text, await readFile(SKILL, 'utf8'))
  })
})

describe('o que é recusado', () => {
  const codigos = Array.from({ length: 51 }, (_, indice) => String(201 + indice))
  const invalidas = [
    ['buscar_produtos', {}],
    ['buscar_produtos', { continuacao: 'x' }],
    ['buscar_produtos', { texto: ' a ' }],
    ['buscar_produtos', { eans: ['20000000000AB'] }],
    ['buscar_produtos', { codprods: [] }],
    ['buscar_produtos', { codprods: codigos }],
    ['grupos_produto', { dentroDe: -1 }],
    ['precos_atuais', {}],
    ['precos_atuais', { produtos: [] }],
    ['precos_atuais', { produtos: codigos.map((codprod) => ({ codprod })) }],
    ['precos_atuais', { produtos: [{ codprod: '101', ean: '2000000000011' }] }],
    ['panorama_precos', {}],
    ['panorama_precos', { escopo: { grupo: 10, marca: 'alfa' } }],
    ['panorama_precos', { escopo: { catalogo: false } }],
    ['panorama_precos', { escopo: { catalogo: true }, limite: 51 }],
    ['panorama_precos', { escopo: { catalogo: true }, agruparPor: 'fornecedor' }],
    ['saude_coleta', { loja: 'Nao Existe' }],
  ] as const

  for (const [ferramenta, argumentos] of invalidas) {
    test(`${ferramenta} com ${JSON.stringify(argumentos).slice(0, 80)}`, async () => {
      const { erro, texto } = await mcp.chamar(ferramenta, argumentos)
      assert.equal(erro, true)
      assert.match(texto, /Input validation error/)
    })
  }

  const inexistentes = [
    ['buscar_produtos', { grupo: 999 }, /grupo não encontrado/],
    ['grupos_produto', { dentroDe: 999 }, /grupo não encontrado/],
    ['panorama_precos', { escopo: { grupo: 999 } }, /grupo não encontrado/],
    ['saude_coleta', { loja: 'leroy' }, /loja não encontrada/],
  ] as const

  for (const [ferramenta, argumentos, frase] of inexistentes) {
    test(`${ferramenta} do que não existe erra, e não devolve vazio`, async () => {
      const { erro, texto, saida } = await mcp.chamar(ferramenta, argumentos)
      assert.deepEqual([erro, saida], [true, undefined])
      assert.match(texto, frase)
    })
  }

  test('estatisticas_preco e buscar_produto não existem mais', async () => {
    for (const nome of ['estatisticas_preco', 'buscar_produto']) {
      await assert.rejects(mcp.cliente.callTool({ name: nome, arguments: {} }), /not found/)
    }
  })
})
