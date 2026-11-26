import type { CallToolResult } from '@modelcontextprotocol/server'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import type { Leituras } from '../banco/leituras.ts'
import { abrirLeituras } from '../banco/leituras.ts'
import { buscarProduto, estatisticasPreco, precosAtuais, saudeColeta } from './ferramentas.ts'
import type { Resposta } from './respostas.ts'
import {
  recusada,
  responderBusca,
  responderEstatisticas,
  responderPrecosAtuais,
  responderSaude,
} from './respostas.ts'

function resultado(resposta: Resposta<Record<string, unknown>>): CallToolResult {
  switch (resposta.tipo) {
    case 'RESPONDIDA':
      return {
        content: [{ type: 'text', text: JSON.stringify(resposta.saida) }],
        structuredContent: resposta.saida,
      }
    case 'RECUSADA':
      return { content: [{ type: 'text', text: resposta.motivo }], isError: true }
    default:
      return resposta satisfies never
  }
}

async function atender(
  resposta: Promise<Resposta<Record<string, unknown>>>,
): Promise<CallToolResult> {
  try {
    return resultado(await resposta)
  } catch (erro) {
    // o SDK devolveria a mensagem do erro, que no Drizzle repete a consulta e os parâmetros
    console.error('a ferramenta falhou:', erro)
    return resultado(recusada('não consegui ler o banco de preços; tente de novo'))
  }
}

/** Os nomes que o `registerTool` usa para o contrato de `ferramentas.ts`. */
function declaracao<E extends z.ZodType, S extends z.ZodType>(ferramenta: {
  readonly titulo: string
  readonly descricao: string
  readonly entrada: E
  readonly saida: S
}) {
  const { titulo, descricao, entrada, saida } = ferramenta
  return { title: titulo, description: descricao, inputSchema: entrada, outputSchema: saida }
}

function criarServidor(leituras: Leituras): McpServer {
  const servidor = new McpServer({ name: 'conexus-pricing', version: '1.0.0' })
  servidor.registerTool(buscarProduto.nome, declaracao(buscarProduto), (entrada) =>
    atender(responderBusca(leituras, entrada)),
  )
  servidor.registerTool(precosAtuais.nome, declaracao(precosAtuais), (entrada) =>
    atender(responderPrecosAtuais(leituras, entrada)),
  )
  servidor.registerTool(estatisticasPreco.nome, declaracao(estatisticasPreco), (entrada) =>
    atender(responderEstatisticas(leituras, entrada)),
  )
  servidor.registerTool(saudeColeta.nome, declaracao(saudeColeta), (entrada) =>
    atender(responderSaude(leituras, entrada)),
  )
  return servidor
}

/** O servidor MCP sobre HTTP, sem sessão: uma instância por pedido, um pool para todas. */
export function criarMcp(urlDoBanco: string) {
  const leituras = abrirLeituras(urlDoBanco)
  return createMcpHandler(() => criarServidor(leituras), {
    onerror: (erro) => console.error('mcp:', erro),
  })
}
