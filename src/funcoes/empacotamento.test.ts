import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { loadConfigFromFile, resolveConfig } from '@neon/config/v1'
import { buildFunctionBundle } from '@neon/config-runtime/v1'
import { unzipSync } from 'fflate'
import { z } from 'zod'
import { abrirBanco, fecharBanco } from '../banco/conexao.ts'
import { criarBancoDescartavel } from '../banco/descartavel.ts'
import { produto } from '../banco/tabelas.ts'
import { abrirLojaDeTeste, comGravacao } from '../coleta/loja-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'

const NEON_TS = fileURLToPath(new URL('../../neon.ts', import.meta.url))
// roda como no runtime: importa o index.mjs do arquivo e chama o fetch, um pedido atrás do outro
const CHAMAR = `
const [arquivo, pedidos] = process.argv.slice(1)
const { default: funcao } = await import(arquivo)
for (const [url, init] of JSON.parse(pedidos)) {
  const resposta = await funcao.fetch(new Request(url, init))
  const corpo = await resposta.json()
  console.log('RESPOSTA ' + JSON.stringify({ status: resposta.status, corpo }))
}
process.exit(0)
`
const Resposta = z.object({ status: z.number(), corpo: z.unknown() })
const executar = promisify(execFile)
const pastas: string[] = []

after(() => {
  for (const pasta of pastas) {
    chmodSync(pasta, 0o755)
    rmSync(pasta, { recursive: true, force: true })
  }
})

async function funcaoDoNeonTs(slug: string) {
  const { config } = await loadConfigFromFile({ path: NEON_TS, unsetFunctionEnv: 'omit' })
  const resolvido = resolveConfig(config, { name: 'main', exists: true, isDefault: true })
  const funcao = resolvido.preview?.functions.find((f) => f.slug === slug)
  assert.ok(funcao, `neon.ts não declara a função ${slug}`)
  return funcao
}

/** Descompacta o arquivo numa pasta sem permissão de escrita, como o disco da função. */
function publicar(zip: Uint8Array): string {
  const pasta = mkdtempSync(join(tmpdir(), 'precos-funcao-'))
  pastas.push(pasta)
  for (const [nome, conteudo] of Object.entries(unzipSync(zip))) {
    mkdirSync(dirname(join(pasta, nome)), { recursive: true })
    writeFileSync(join(pasta, nome), conteudo)
  }
  chmodSync(pasta, 0o555)
  return pasta
}

async function chamar(
  pasta: string,
  env: Record<string, string>,
  pedidos: readonly (readonly [string, RequestInit])[],
) {
  const argumentos = ['--input-type=module', '-e', CHAMAR, '--', join(pasta, 'index.mjs')]
  const { stdout } = await executar(process.execPath, [...argumentos, JSON.stringify(pedidos)], {
    cwd: pasta,
    // sem PATH: o runtime não promete nenhum programa
    env: { PATH: '', ...env },
    timeout: 60_000,
  })
  const linhas = stdout.split('\n').filter((linha) => linha.startsWith('RESPOSTA '))
  return linhas.map((linha) => Resposta.parse(JSON.parse(linha.slice('RESPOSTA '.length))))
}

function banco(slug: 'coleta' | 'mcp', url = urlDoBancoDeTeste()): Record<string, string> {
  if (slug === 'mcp') return { LEITOR_DATABASE_URL: url }
  return { COLETOR_DATABASE_URL: url }
}

/** Um banco migrado com um produto no catálogo; devolve a URL da role da coleta. */
async function bancoDeRodada() {
  const descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
  await descartavel.migrar()
  const dono = abrirBanco(descartavel.urls.dono)
  await dono
    .insert(produto)
    .values({ codprod: '1', ean: '2000000000011', descricao: 'Item de teste' })
  await fecharBanco(dono)
  return {
    url: descartavel.urls.coletor,
    [Symbol.asyncDispose]: () => descartavel.apagar(),
  }
}

function entrega(agendadaPara: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'x-neon-trigger-invocation-id': 'entrega-1' },
    body: JSON.stringify({
      version: 1,
      invocation_id: 'entrega-1',
      trigger: { type: 'schedule', id: 'gatilho-1', name: 'condec' },
      data: { scheduled_at: agendadaPara },
    }),
  }
}

describe('o arquivo que o neon deploy sobe', () => {
  for (const slug of ['coleta', 'mcp'] as const) {
    test(`${slug} carrega e consulta o banco`, async () => {
      const pasta = publicar(await buildFunctionBundle(await funcaoDoNeonTs(slug)))
      const [resposta] = await chamar(pasta, banco(slug), [['https://funcao.teste/', {}]])
      // o dono não é a role da função: a recusa prova que o SELECT rodou dentro do bundle
      assert.equal(resposta?.status, 503)
      assert.partialDeepStrictEqual(resposta.corpo, { motivo: 'ROLE_ERRADA' })
    })
  }

  test('a coleta empacotada roda duas rodadas no mesmo processo, sem disco', async () => {
    await using loja = await abrirLojaDeTeste((pedido) => comGravacao(pedido))
    await using rodada = await bancoDeRodada()
    const coleta = await funcaoDoNeonTs('coleta')
    const fixture = { ...coleta, source: 'src/funcoes/rodada-empacotada.fixture.ts' }
    const pasta = publicar(await buildFunctionBundle(fixture))
    const url = `https://funcao.teste/condec?loja=${encodeURIComponent(loja.url(''))}`
    const respostas = await chamar(pasta, banco('coleta', rodada.url), [
      [url, entrega('2026-11-30T06:00:00Z')],
      [url, entrega('2026-12-07T06:00:00Z')],
    ])
    const Fechada = z.object({ situacao: z.string(), contagens: z.object({ OK: z.number() }) })
    assert.deepEqual(
      respostas.map((r) => Fechada.parse(r.corpo)),
      [
        { situacao: 'CONCLUIDA', contagens: { OK: 1 } },
        { situacao: 'CONCLUIDA', contagens: { OK: 1 } },
      ],
    )
    assert.equal(loja.pedidos.length, 2)
    assert.equal(existsSync(join(pasta, 'storage')), false)
  })
})
