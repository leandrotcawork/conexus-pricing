import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { asc } from 'drizzle-orm'
import oracledb from 'oracledb'
import { z } from 'zod'
import type { Banco } from '../src/banco/conexao.ts'
import { abrirBanco, fecharBanco } from '../src/banco/conexao.ts'
import { criarBancoDescartavel } from '../src/banco/descartavel.ts'
import { produto } from '../src/banco/tabelas.ts'
import { oracleDeTeste, urlDoBancoDeTeste } from '../src/config.ts'
import { NOMES_DAS_TABELAS, semearSankhya } from './sankhya-de-teste.ts'

const CARGA = fileURLToPath(new URL('carga-catalogo.ts', import.meta.url))
const executar = promisify(execFile)
const oracle = oracleDeTeste()
const SEM_ORACLE = oracle ? false : 'sem TEST_ORACLE_HOST: não há Oracle local para ler'

function rodarCarga(env: Record<string, string>) {
  return executar(process.execPath, [CARGA], { env })
}

describe('scripts/carga-catalogo.ts sem o ambiente completo', () => {
  test('recusa pelo nome das variáveis, sem repetir nenhum valor', async () => {
    const carga = rodarCarga({
      DATABASE_URL_UNPOOLED: 'postgres://dono:segredo-do-banco@127.0.0.1:1/precos',
      SANKHYA_ORACLE_PASSWORD: 'segredo-do-oracle',
      SANKHYA_ORACLE_SCHEMA: 'nome; segredo-do-esquema',
    })
    await assert.rejects(carga, ({ stderr }: { stderr: string }) => {
      for (const nome of ['HOST', 'SERVICE_NAME', 'USER', 'SCHEMA']) {
        assert.match(stderr, new RegExp(`SANKHYA_ORACLE_${nome}`))
      }
      assert.doesNotMatch(stderr, /segredo-do/)
      return true
    })
  })
})

function nomeNovo(prefixo: string): string {
  return `${prefixo}_${randomUUID().replaceAll('-', '').slice(0, 12)}`.toUpperCase()
}

const TabelaRecemMudada = z.object({ errorNum: z.literal(1466) })

/**
 * Logo depois do DDL, uma leitura em `READ ONLY` pode falhar com ORA-01466, porque o Oracle só
 * resolve o instante dela com alguns segundos de grão. Espera até a leitura da carga passar.
 */
async function esperarLeitura(conexao: oracledb.Connection, dono: string): Promise<void> {
  for (;;) {
    try {
      await conexao.execute('SET TRANSACTION READ ONLY')
      for (const tabela of NOMES_DAS_TABELAS) {
        await conexao.execute(`SELECT COUNT(*) FROM ${dono}.${tabela}`)
      }
      return
    } catch (erro) {
      if (!TabelaRecemMudada.safeParse(erro).success) throw erro
    } finally {
      await conexao.rollback()
    }
    await setTimeout(500)
  }
}

/**
 * Um dono das tabelas falsas e um leitor que só tem SELECT nelas, os dois novos e apagados no fim:
 * nada que já exista no servidor é tocado, e criar usuário exige a senha de um administrador.
 */
async function criarSankhyaDescartavel(config: NonNullable<typeof oracle>) {
  const connectString = `${config.host}:${config.porta}/${config.servico}`
  const system = await oracledb.getConnection({
    user: 'system',
    password: config.senhaDoSystem,
    connectString,
  })
  const senha = nomeNovo('S')
  const nomes = { dono: nomeNovo('PRECOS_DONO'), leitor: nomeNovo('PRECOS_LEITOR') }
  for (const nome of Object.values(nomes)) {
    await system.execute(`CREATE USER ${nome} IDENTIFIED BY ${senha} QUOTA UNLIMITED ON users`)
    await system.execute(`GRANT CREATE SESSION TO ${nome}`)
  }
  await system.execute(`GRANT CREATE TABLE TO ${nomes.dono}`)
  const dono = await oracledb.getConnection({ user: nomes.dono, password: senha, connectString })
  await semearSankhya((sql, binds) => dono.execute(sql, binds))
  for (const tabela of NOMES_DAS_TABELAS) {
    await dono.execute(`GRANT SELECT ON ${tabela} TO ${nomes.leitor}`)
  }
  await dono.commit()
  const leitor = await oracledb.getConnection({
    user: nomes.leitor,
    password: senha,
    connectString,
  })
  await esperarLeitura(leitor, nomes.dono)
  await leitor.close()
  return {
    env: {
      SANKHYA_ORACLE_HOST: config.host,
      SANKHYA_ORACLE_PORT: String(config.porta),
      SANKHYA_ORACLE_SERVICE_NAME: config.servico,
      SANKHYA_ORACLE_USER: nomes.leitor,
      SANKHYA_ORACLE_PASSWORD: senha,
      SANKHYA_ORACLE_SCHEMA: nomes.dono,
      LD_LIBRARY_PATH: config.bibliotecas,
    },
    async mudar(sql: string): Promise<void> {
      await dono.execute(sql, [], { autoCommit: true })
    },
    async apagar(): Promise<void> {
      await dono.close()
      for (const nome of Object.values(nomes)) await system.execute(`DROP USER ${nome} CASCADE`)
      await system.close()
    },
  }
}

// codprod, EAN, referência do fabricante, marca, nosso preço em centavos
const GABARITO = [
  ['101', '2000000000101', 'FAB-101', 'Marca A', 1234],
  ['102', '2000000000102', null, 'Marca B', 2000],
  ['103', '200000000103', 'FAB-103', null, null],
  ['104', '20000000000104', 'FAB-104', 'Marca A', null],
  ['105', '2000000000105', 'FAB-105', 'Marca A', 555],
  ['106', '2000000000106', 'FAB-106', 'Marca A', null],
] as const

const SAIDA = `produtos do recorte R3: 6
sem nosso preço: 3
classe A: 2 (acumulado 2)
classe B: 2 (acumulado 4)
classe C: 2 (acumulado 6)
linhas em precos.produto: 6
`

describe('scripts/carga-catalogo.ts contra o Oracle local', { skip: SEM_ORACLE }, () => {
  let sankhya: Awaited<ReturnType<typeof criarSankhyaDescartavel>>
  let descartavel: Awaited<ReturnType<typeof criarBancoDescartavel>>
  let banco: Banco

  before(async () => {
    assert.ok(oracle)
    sankhya = await criarSankhyaDescartavel(oracle)
    descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
    await descartavel.migrar()
    banco = abrirBanco(descartavel.urls.dono)
  })

  after(async () => {
    await fecharBanco(banco)
    await descartavel.apagar()
    await sankhya.apagar()
  })

  function carregar() {
    return rodarCarga({ ...sankhya.env, DATABASE_URL_UNPOOLED: descartavel.urls.dono })
  }

  function catalogo() {
    return banco.select().from(produto).orderBy(asc(produto.codprod))
  }

  async function resumido() {
    const linhas = await catalogo()
    return linhas.map((l) => [
      l.codprod,
      l.ean,
      l.referenciaFabricante,
      l.marca,
      l.nossoPrecoCentavos,
    ])
  }

  test('grava o recorte do gabarito e imprime só as contagens', async () => {
    const { stdout, stderr } = await carregar()
    assert.equal(stdout, SAIDA)
    assert.equal(stderr, '')
    assert.deepEqual(await resumido(), GABARITO)
    const [primeiro] = await catalogo()
    assert.equal(primeiro?.descricao, 'Item inventado 101')
  })

  test('rodar de novo não cria linha nova', async () => {
    const antes = await catalogo()
    assert.equal((await carregar()).stdout, SAIDA)
    const depois = await catalogo()
    assert.deepEqual(
      depois.map((linha) => linha.id),
      antes.map((linha) => linha.id),
    )
    assert.deepEqual(await resumido(), GABARITO)
  })

  test('uma operação sem descrição para a carga, sem gravar nada', async () => {
    await sankhya.mudar('UPDATE TGFEXC SET VLRVENDA = 25 WHERE NUTAB = 1 AND CODPROD = 102')
    await sankhya.mudar("INSERT INTO TGFCAB VALUES (900, 'V', 'L', TRUNC(SYSDATE), 999)")
    await sankhya.mudar('INSERT INTO TGFITE VALUES (900, 101, 1, 0)')
    await assert.rejects(carregar(), /operação sem descrição no TGFTOP/)
    assert.deepEqual(await resumido(), GABARITO)
    await sankhya.mudar('DELETE FROM TGFCAB WHERE NUNOTA = 900')
  })

  test('a carga seguinte traz o preço que mudou no Sankhya', async () => {
    assert.equal((await carregar()).stdout, SAIDA)
    const [, segundo] = await resumido()
    assert.equal(segundo?.[4], 2500)
  })

  test('um recorte vazio é recusado e o catálogo fica como estava', async () => {
    const antes = await catalogo()
    await sankhya.mudar('DELETE FROM TGFCAB')
    await assert.rejects(carregar(), /o recorte veio vazio e nada foi gravado/)
    assert.deepEqual(await catalogo(), antes)
  })
})
