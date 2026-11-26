import assert from 'node:assert/strict'
import type { ClientOptions } from '@modelcontextprotocol/client'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { criarFuncaoMcp } from './mcp.ts'

export const TOKEN = 'token_inventado_para_teste_0000000000'
export const ENDERECO = 'https://funcao.teste/mcp'

/** O cliente MCP do SDK falando com o `fetch` da função, no mesmo processo. */
export async function conectar(
  urlDoBanco: string,
  { token = TOKEN, ...opcoes }: ClientOptions & { readonly token?: string | null } = {},
) {
  const funcao = criarFuncaoMcp({ urlDoBanco, token: TOKEN })
  const cliente = new Client({ name: 'teste', version: '1.0.0' }, opcoes)
  const transporte = new StreamableHTTPClientTransport(new URL(ENDERECO), {
    fetch: (url, init) => funcao.fetch(new Request(url, init)),
    requestInit: { headers: token === null ? {} : { authorization: `Bearer ${token}` } },
  })
  await cliente.connect(transporte)
  // com a lista lida, o cliente confere cada resposta contra o outputSchema anunciado
  const { tools } = await cliente.listTools()

  async function chamar(nome: string, argumentos: Record<string, unknown>) {
    const lido = await cliente.callTool({ name: nome, arguments: argumentos })
    const [conteudo] = lido.content
    assert.equal(conteudo?.type, 'text')
    return { erro: lido.isError === true, texto: conteudo.text, saida: lido.structuredContent }
  }

  return {
    cliente,
    ferramentas: tools,
    chamar,
    /** A resposta que deu certo, com o texto dizendo o mesmo que a saída estruturada. */
    async responder(nome: string, argumentos: Record<string, unknown>) {
      const { erro, texto, saida } = await chamar(nome, argumentos)
      assert.equal(erro, false, texto)
      assert.deepEqual(JSON.parse(texto), saida)
      return saida
    },
  }
}
