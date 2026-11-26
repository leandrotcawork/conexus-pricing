import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { abrirLojaDeTeste } from '../src/coleta/loja-de-teste.ts'
import { gravacaoDe } from '../src/plataformas/conformidade.ts'

const executar = promisify(execFile)
const SCRIPT = join(import.meta.dirname, 'lote-loja.ts')
const BALAROTI = new URL('../src/plataformas/wake/gravacoes/balaroti/', import.meta.url)
const COPAFER = new URL('../src/plataformas/vtex/gravacoes/copafer/', import.meta.url)
const [EAN_A, EAN_B, SEM_PRODUTO] = ['2000000000011', '2000000000012', '2000000000008']

function contagens(valores: Readonly<Record<string, number>>): RegExp {
  const linhas = ['OK', 'SEM_ESTOQUE', 'SEM_PRECO', 'NAO_ENCONTRADO', 'ERRO']
    .map((situacao) => `${situacao}: ${valores[situacao] ?? 0}\n`)
    .join('')
  return new RegExp(`^${linhas}tempo: [0-9]+\\.[0-9] s\n$`)
}

describe('scripts/lote-loja.ts', { concurrency: true }, () => {
  const pasta = mkdtempSync(join(tmpdir(), 'lote-loja-'))
  after(() => rmSync(pasta, { recursive: true }))

  function arquivoCom(nome: string, linhas: readonly string[]): string {
    const caminho = join(pasta, nome)
    writeFileSync(caminho, `${linhas.join('\n')}\n`)
    return caminho
  }

  function rodar(argumentos: readonly string[]) {
    return executar(process.execPath, [SCRIPT, ...argumentos])
  }

  test('prepara, pergunta com pausa e imprime só as contagens e o tempo', async () => {
    // a resposta demora: só uma pausa contada depois dela passa de ATRASO_MS + 2 s
    const ATRASO_MS = 1500
    await using loja = await abrirLojaDeTeste(({ metodo }) => ({
      ...gravacaoDe(BALAROTI, metodo === 'GET' ? 'preparo' : 'lote'),
      atrasoMs: ATRASO_MS,
    }))
    // um EAN repetido conta uma vez
    const eans = arquivoCom('balaroti.txt', [EAN_A, EAN_B, '', SEM_PRODUTO, EAN_A])

    const { stdout } = await rodar(['balaroti', eans, '--base', loja.url('/')])

    assert.match(stdout, contagens({ OK: 2, NAO_ENCONTRADO: 1 }))
    assert.deepEqual(
      loja.pedidos.map(({ metodo, cabecalhos }) => [metodo, cabecalhos['x-origem']]),
      [
        ['GET', 'https://www.balaroti.com.br'],
        ['POST', 'https://storefront-api.fbits.net'],
      ],
    )
    const [preparo, lote] = loja.pedidos
    assert.ok(preparo && lote && lote.em - preparo.em >= ATRASO_MS + 2000)
  })

  test('um lote recusado é refeito um a um, e o que falha assim conta como ERRO', async () => {
    await using loja = await abrirLojaDeTeste(({ caminho }) => {
      const sozinho = caminho.split('alternateIds_Ean').length === 2
      return gravacaoDe(COPAFER, sozinho && caminho.includes(EAN_A) ? 'lote' : 'erro')
    })
    const eans = arquivoCom('copafer.txt', [EAN_A, EAN_B])

    const { stdout } = await rodar(['copafer', eans, '--base', loja.url('/')])

    assert.match(stdout, contagens({ OK: 1, ERRO: 1 }))
    assert.equal(loja.pedidos.length, 3)
    for (const [indice, pedido] of loja.pedidos.entries()) {
      const anterior = loja.pedidos[indice - 1]
      if (anterior) assert.ok(pedido.em - anterior.em >= 2000, `pausa do pedido ${indice + 1}`)
    }
  })

  test('uma linha que não é EAN é apontada pelo número, sem repetir o valor', async () => {
    const eans = arquivoCom('invalido.txt', [EAN_A, 'codigo-interno-9876'])
    await assert.rejects(rodar(['copafer', eans]), ({ stderr }: { stderr: string }) => {
      assert.match(stderr, /linha 2 do arquivo: não é um EAN/)
      assert.doesNotMatch(stderr, /codigo-interno/)
      return true
    })
  })

  test('uma loja que as migrações não criam é recusada com as que existem', async () => {
    const eans = arquivoCom('um.txt', [EAN_A])
    await assert.rejects(rodar(['docol', eans]), /loja desconhecida.*balaroti.*copafer/)
  })
})
