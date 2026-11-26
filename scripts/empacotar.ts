import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FunctionBundler } from '@neon/config/v1'
import type { Plugin } from 'esbuild'
import { build } from 'esbuild'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
// o mesmo que o empacotador padrão do Neon põe no topo: dependências CommonJS dentro de um ESM
const INTEROP =
  "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);"

/** O header-generator lê seus modelos de `${__dirname}/data_files`: eles vão ao lado do bundle. */
async function dadosDoGerador(entradas: readonly string[]) {
  const raizDoPacote = /^(.*node_modules\/header-generator)\//
  const pacotes = new Set(entradas.flatMap((entrada) => raizDoPacote.exec(entrada)?.[1] ?? []))
  const [pacote, ...outros] = pacotes
  if (pacote === undefined || outros.length > 0) {
    throw new Error(`esperava um header-generator no bundle, achei ${pacotes.size}`)
  }
  const pasta = join(RAIZ, pacote, 'data_files')
  const nomes = await readdir(pasta)
  const arquivos = nomes.map(
    async (nome) => [`data_files/${nome}`, await readFile(join(pasta, nome))] as const,
  )
  return Object.fromEntries(await Promise.all(arquivos))
}

/** O mesmo esbuild do `neon deploy`, a partir das versões do lockfile. */
async function construir(
  funcao: Parameters<FunctionBundler>[0],
  opcoes: { readonly keepNames?: boolean; readonly plugins?: Plugin[] },
) {
  const resultado = await build({
    absWorkingDir: RAIZ,
    entryPoints: [funcao.source],
    bundle: true,
    write: false,
    outfile: 'index.mjs',
    minify: true,
    format: 'esm',
    platform: 'node',
    banner: { js: INTEROP },
    metafile: true,
    logLevel: 'silent',
    ...opcoes,
  })
  const [saida] = resultado.outputFiles
  if (saida === undefined) throw new Error(`o esbuild não gerou a função ${funcao.slug}`)
  return { saida: saida.contents, entradas: Object.keys(resultado.metafile.inputs) }
}

/**
 * O empacotador padrão do `neon deploy` quebra o Crawlee 3.18.2: a minificação renomeia classes
 * de que ele depende e os arquivos de dados ficam de fora. Aqui os nomes são preservados e os
 * dados copiados.
 */
export const empacotarComCrawlee: FunctionBundler = async (funcao) => {
  const { saida, entradas } = await construir(funcao, { keepNames: true })
  return { 'index.mjs': saida, ...(await dadosDoGerador(entradas)) }
}

const skillEmbutida: Plugin = {
  name: 'skill-embutida',
  setup(construcao) {
    construcao.onLoad({ filter: /[\\/]src[\\/]mcp[\\/]skill\.ts$/ }, async () => {
      const texto = await readFile(join(RAIZ, 'skills/analise-precos/SKILL.md'), 'utf8')
      return { contents: `export const SKILL_ANALISE_PRECOS = ${JSON.stringify(texto)}` }
    })
  },
}

/** A skill vai dentro do `index.mjs`: a função não depende de arquivo ao lado. */
export const empacotarComSkill: FunctionBundler = async (funcao) => {
  const { saida } = await construir(funcao, { plugins: [skillEmbutida] })
  return { 'index.mjs': saida }
}
