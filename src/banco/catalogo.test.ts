import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { inspect } from 'node:util'
import { asc } from 'drizzle-orm'
import { urlDoBancoDeTeste } from '../config.ts'
import type { Grupo } from '../dominio/grupo.ts'
import { Centavos, CodGrupo, Codprod, Ean } from '../dominio/marcas.ts'
import type { ItemDoRecorte, ProdutoDoCatalogo } from '../dominio/recorte.ts'
import { gravarCatalogo } from './catalogo.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { grupo, produto } from './tabelas.ts'

function item(codprod: string, mudancas: Partial<ProdutoDoCatalogo> = {}): ItemDoRecorte {
  return {
    produto: {
      codprod: Codprod.parse(codprod),
      ean: Ean.parse('2000000000015'),
      referenciaFabricante: 'REF-1',
      descricao: `Item ${codprod}`,
      marca: 'Marca inventada',
      grupo: CodGrupo.parse(20),
      nossoPreco: Centavos.parse(1234),
      ...mudancas,
    },
    classe: 'A',
    venda12m: 5_000_000_000,
  }
}

function categoria(codigo: number, pai: number | null, nome = `Grupo ${codigo}`): Grupo {
  return {
    codigo: CodGrupo.parse(codigo),
    nome,
    pai: pai === null ? null : CodGrupo.parse(pai),
    grau: pai === null ? 1 : 2,
    analitico: pai !== null,
    ativo: true,
  }
}

// o filho vem antes do pai, como o Sankhya pode devolver
const GRUPOS = [categoria(20, 10), categoria(10, null)]

function gravar(banco: Banco, itens: readonly ItemDoRecorte[], grupos = GRUPOS) {
  return gravarCatalogo(banco, { grupos, itens })
}

let descartavel: Awaited<ReturnType<typeof criarBancoDescartavel>>
let dono: Banco

before(async () => {
  descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
  await descartavel.migrar()
  dono = abrirBanco(descartavel.urls.dono)
})

after(async () => {
  await fecharBanco(dono)
  await descartavel.apagar()
})

function noBanco() {
  return dono.select().from(produto).orderBy(asc(produto.codprod))
}

describe('a gravação do catálogo', () => {
  test('rodar duas vezes não cria linha nova', async () => {
    assert.equal(await gravar(dono, [item('1'), item('2')]), 2)
    const antes = await noBanco()
    assert.equal(await gravar(dono, [item('1'), item('2')]), 2)
    const depois = await noBanco()
    assert.deepEqual(
      depois.map(({ id, codprod }) => [id, codprod]),
      antes.map(({ id, codprod }) => [id, codprod]),
    )
  })

  test('repetir atualiza cada campo do produto, inclusive o preço que sumiu', async () => {
    const mudado = item('1', {
      ean: Ean.parse('2000000000022'),
      referenciaFabricante: null,
      descricao: 'Item renomeado',
      marca: null,
      grupo: null,
      nossoPreco: null,
    })
    const [antes] = await noBanco()
    const outraClasse = { ...mudado, classe: 'C', venda12m: 0 } as const
    assert.equal(await gravar(dono, [outraClasse, item('3')]), 3)
    const [primeiro, segundo] = await noBanco()
    assert.ok(antes && primeiro && segundo)
    const { id, carregadoEm, ...campos } = primeiro
    assert.deepEqual(campos, {
      codprod: '1',
      ean: '2000000000022',
      referenciaFabricante: null,
      descricao: 'Item renomeado',
      marca: null,
      nossoPrecoCentavos: null,
      grupoCodigo: null,
      classe: 'C',
      venda12mCentavos: 0,
    })
    assert.equal(id, antes.id)
    assert.ok(carregadoEm > antes.carregadoEm)
    // quem não veio nesta carga continua como estava
    assert.equal(segundo.nossoPrecoCentavos, 1234)
    // a venda passa do limite de um integer
    assert.deepEqual(
      [segundo.grupoCodigo, segundo.classe, segundo.venda12mCentavos],
      [20, 'A', 5_000_000_000],
    )
  })
})

describe('os grupos do catálogo', () => {
  test('repetir atualiza o nome e o pai de um grupo, e o que saiu do Sankhya fica', async () => {
    await gravar(dono, [], [categoria(30, null), categoria(20, 30, 'Renomeado')])
    const gravados = await dono.select().from(grupo).orderBy(asc(grupo.codigo))
    assert.deepEqual(
      gravados.map(({ codigo, nome, pai }) => [codigo, nome, pai]),
      [
        [10, 'Grupo 10', null],
        [20, 'Renomeado', 30],
        [30, 'Grupo 30', null],
      ],
    )
  })

  test('um pai ou um grupo de produto que não existe é recusado pelo banco', async () => {
    const antes = await noBanco()
    await assert.rejects(gravar(dono, [], [categoria(40, 999)]), {
      message: 'não consegui gravar o catálogo: 23503 grupo_pai_existe',
    })
    await assert.rejects(gravar(dono, [item('7', { grupo: CodGrupo.parse(999) })]), {
      message: 'não consegui gravar o catálogo: 23503 produto_grupo_codigo_grupo_codigo_fkey',
    })
    assert.deepEqual(await noBanco(), antes)
  })

  test('uma recusa não grava nada e não repete os dados do catálogo', async () => {
    const antes = await noBanco()
    // o mesmo codprod duas vezes na mesma carga é recusado pelo Postgres
    const repetido = gravar(dono, [item('8'), item('9'), item('9')])
    await assert.rejects(repetido, (erro: Error) => {
      assert.equal(erro.message, 'não consegui gravar o catálogo: 21000')
      assert.doesNotMatch(inspect(erro), /Item 9|Marca inventada/)
      return true
    })
    assert.deepEqual(await noBanco(), antes)
  })
})

describe('a gravação do catálogo acima do limite do protocolo', () => {
  // 9 parâmetros por linha: acima disto um comando só passaria dos 65535 do protocolo
  const ALEM_DO_LIMITE = Math.floor(65_535 / 9) + 1_000
  const muitos = Array.from({ length: ALEM_DO_LIMITE }, (_, i) => item(String(100_000 + i)))

  test('uma recusa no fim de uma carga grande não grava nem o começo', async () => {
    const antes = await noBanco()
    const ultimo = muitos.at(-1)
    assert.ok(ultimo)
    const repetido = gravar(dono, [...muitos, ultimo])
    await assert.rejects(repetido, { message: 'não consegui gravar o catálogo: 21000' })
    assert.deepEqual(await noBanco(), antes)
  })

  test('uma carga acima do limite de parâmetros do protocolo entra inteira e repete sem criar linha', async () => {
    const antes = (await noBanco()).length
    assert.equal(await gravar(dono, muitos), antes + muitos.length)
    assert.equal(await gravar(dono, muitos), antes + muitos.length)
  })
})
