import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FunctionBundler } from '@neon/config/v1'
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

/**
 * O empacotador padrão do `neon deploy` quebra o Crawlee 3.18.2: a minificação renomeia classes
 * de que ele depende e os arquivos de dados ficam de fora. Este é o mesmo esbuild, com os nomes
 * preservados e os dados copiados, a partir das versões do lockfile.
 */
export const empacotarComCrawlee: FunctionBundler = async (funcao) => {
  const resultado = await build({
    absWorkingDir: RAIZ,
    entryPoints: [funcao.source],
    bundle: true,
    write: false,
    outfile: 'index.mjs',
    minify: true,
    keepNames: true,
    format: 'esm',
    platform: 'node',
    banner: { js: INTEROP },
    metafile: true,
    logLevel: 'silent',
  })
  const [saida] = resultado.outputFiles
  if (saida === undefined) throw new Error(`o esbuild não gerou a função ${funcao.slug}`)
  const dados = await dadosDoGerador(Object.keys(resultado.metafile.inputs))
  return { 'index.mjs': saida.contents, ...dados }
}
