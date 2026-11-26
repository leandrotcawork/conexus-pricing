import { defineConfig } from '@neon/config/v1'
import { empacotarComCrawlee, empacotarComSkill } from './scripts/empacotar.ts'
import { valoresDaPublicacao } from './src/config.ts'

const valores = valoresDaPublicacao()

/** `required` faz o deploy falhar sem o valor, e importar este arquivo nunca falha. */
function obrigatoria(value: string | undefined) {
  return { value, required: true }
}

export default defineConfig({
  functions: {
    coleta: {
      name: 'coleta de precos',
      source: 'src/funcoes/coleta.ts',
      bundler: empacotarComCrawlee,
      env: { COLETOR_DATABASE_URL: obrigatoria(valores.coletorUrl) },
    },
    mcp: {
      name: 'mcp de precos',
      source: 'src/funcoes/mcp.ts',
      bundler: empacotarComSkill,
      env: {
        LEITOR_DATABASE_URL: obrigatoria(valores.leitorUrl),
        MCP_TOKEN: obrigatoria(valores.mcpToken),
      },
    },
  },
})
