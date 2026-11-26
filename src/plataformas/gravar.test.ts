import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { lerGravacao } from './gravacao.ts'

const executar = promisify(execFile)
const SCRIPT = join(import.meta.dirname, '../../scripts/gravar.ts')
const EANS_REAIS = ['7890000000017', '7890000000024']
const TOKEN_REAL = 'tcs_secreto_11111111111111111111'
const PRECO = /("(?:Price|ListPrice|price|listPrice|promotional_price)": ?"?)([0-9.]+)/g

const LOJAS = [
  { plataforma: 'vtex', config: { origem: 'https://www.telhanorte.com.br', lote: 50 } },
  { plataforma: 'tray', config: { origem: 'https://www.condec.com.br', lote: 25 } },
  {
    plataforma: 'wake',
    config: {
      loja: 'https://www.abcdaconstrucao.com.br',
      api: 'https://storefront-api.fbits.net/graphql',
      lote: 25,
      tokenReserva: 'tcs_reserva_inventada_0000000000',
    },
  },
]

function comValoresSecretos(corpo: string): string {
  return corpo
    .replaceAll('2000000000011', EANS_REAIS[0] ?? '')
    .replaceAll('2000000000012', EANS_REAIS[1] ?? '')
    .replaceAll('tcs_inventado_00000000000000000000', TOKEN_REAL)
    .replaceAll('inventado', 'secreto')
    .replace(PRECO, (_, campo: string, valor: string) => {
      const real = Number(valor) > 0 ? (Number(valor) + 7000).toFixed(2) : valor
      return `${campo}${real}`
    })
    .replace(/\{/, '{"segredo":"campo a mais",')
}

function semData(gravacao: string): string {
  return gravacao.replace(/^(.*) · \d{4}-\d{2}-\d{2}\n/, '$1\n')
}

function rodar(argumentos: readonly string[]) {
  return executar(process.execPath, [SCRIPT, ...argumentos])
}

describe('scripts/gravar.ts', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gravar-'))
  after(() => rmSync(pasta, { recursive: true }))

  for (const { plataforma, config } of LOJAS) {
    test(`refaz as gravações da ${plataforma} sem deixar passar valor real`, async () => {
      const gravadas = new URL(`./${plataforma}/gravacoes/`, import.meta.url)
      const cru = join(pasta, `${plataforma}-cru`)
      const destino = join(pasta, `${plataforma}-saida`)
      const argumentos = [plataforma, JSON.stringify(config), ...EANS_REAIS]
      const opcoes = ['--cru', cru, '--destino', destino]
      mkdirSync(cru)
      for (const arquivo of readdirSync(gravadas)) {
        const { corpo, ...resposta } = lerGravacao(readFileSync(new URL(arquivo, gravadas), 'utf8'))
        const original = { ...resposta, corpo: comValoresSecretos(corpo) }
        if (arquivo === 'lote.txt') assert.match(original.corpo, /segredo[\s\S]*secreto/)
        writeFileSync(join(cru, arquivo.replace('.txt', '.json')), JSON.stringify(original))
      }

      await rodar([...argumentos, ...opcoes])

      assert.deepEqual(readdirSync(destino).sort(), readdirSync(gravadas).sort())
      for (const arquivo of readdirSync(destino)) {
        const saida = readFileSync(join(destino, arquivo), 'utf8')
        assert.doesNotMatch(saida, /secret|segredo|789000|70\d\d\.\d/, arquivo)
        assert.equal(
          semData(saida),
          semData(readFileSync(new URL(arquivo, gravadas), 'utf8')),
          arquivo,
        )
      }
    })
  }

  test('recusa guardar respostas originais dentro do repositório', async () => {
    const dentro = join(import.meta.dirname, 'cru')
    const [loja] = LOJAS
    const argumentos = ['vtex', JSON.stringify(loja?.config), ...EANS_REAIS, '--cru', dentro]
    await assert.rejects(rodar(argumentos), /fora do repositório/)
    assert.equal(existsSync(dentro), false)
  })
})
