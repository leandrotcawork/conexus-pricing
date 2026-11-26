import type { CallToolResult } from '@modelcontextprotocol/server'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { memorySkillFiles, SkillsExtension } from '@modelcontextprotocol/server/ext/skills'
import type { z } from 'zod'
import type { Leituras } from '../banco/leituras.ts'
import { abrirLeituras } from '../banco/leituras.ts'
import { buscarProdutos, gruposProduto, precosAtuais } from './ferramentas.ts'
import { panoramaPrecos, saudeColeta } from './ferramentas-de-mercado.ts'
import { INSTRUCOES } from './instrucoes.ts'
import { responderPanorama } from './responder-panorama.ts'
import { responderBusca, responderGrupos, responderPrecosAtuais } from './responder-produtos.ts'
import { responderSaude } from './responder-saude.ts'
import type { Resposta } from './respostas.ts'
import { recusada } from './respostas.ts'
import { SKILL_ANALISE_PRECOS } from './skill.ts'

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

function declaracao<E extends z.ZodType, S extends z.ZodType>(ferramenta: {
  readonly titulo: string
  readonly descricao: string
  readonly entrada: E
  readonly saida: S
}) {
  const { titulo, descricao, entrada, saida } = ferramenta
  return { title: titulo, description: descricao, inputSchema: entrada, outputSchema: saida }
}

/** A ordem do registro é a do `tools/list`. */
function criarServidor(leituras: Leituras): McpServer {
  const servidor = new McpServer(
    { name: 'conexus-pricing', version: '1.0.0' },
    { instructions: INSTRUCOES },
  )
  servidor.registerTool(buscarProdutos.nome, declaracao(buscarProdutos), (entrada) =>
    atender(responderBusca(leituras, entrada)),
  )
  servidor.registerTool(gruposProduto.nome, declaracao(gruposProduto), (entrada) =>
    atender(responderGrupos(leituras, entrada)),
  )
  servidor.registerTool(precosAtuais.nome, declaracao(precosAtuais), (entrada) =>
    atender(responderPrecosAtuais(leituras, entrada)),
  )
  servidor.registerTool(panoramaPrecos.nome, declaracao(panoramaPrecos), (entrada) =>
    atender(responderPanorama(leituras, entrada)),
  )
  servidor.registerTool(saudeColeta.nome, declaracao(saudeColeta), (entrada) =>
    atender(responderSaude(leituras, entrada)),
  )
  return servidor
}

function carregarSkills() {
  const arquivos = memorySkillFiles({ 'analise-precos/SKILL.md': SKILL_ANALISE_PRECOS })
  // strict: uma skill fora das regras derruba o pedido em vez de sumir da lista com um aviso
  return SkillsExtension.load(arquivos, { strict: true })
}

/** O servidor MCP sobre HTTP, sem sessão: uma instância por pedido, um pool para todas. */
export function criarMcp(urlDoBanco: string) {
  const leituras = abrirLeituras(urlDoBanco)
  let skills: ReturnType<typeof carregarSkills> | undefined
  return createMcpHandler(
    async () => {
      const servidor = criarServidor(leituras)
      skills ??= carregarSkills()
      const catalogo = await skills
      catalogo.attach(servidor)
      return servidor
    },
    { onerror: (erro) => console.error('mcp:', erro) },
  )
}
