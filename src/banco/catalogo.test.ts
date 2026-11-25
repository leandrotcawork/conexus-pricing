import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { inspect } from 'node:util'
import { asc } from 'drizzle-orm'
import { urlDoBancoDeTeste } from '../config.ts'
import { Centavos, Codprod, Ean } from '../dominio/marcas.ts'
import type { ProdutoDoCatalogo } from '../dominio/recorte.ts'
import { gravarCatalogo } from './catalogo.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { produto } from './tabelas.ts'

function item(codprod: string, mudancas: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo {
  return {
    codprod: Codprod.parse(codprod),
    ean: Ean.parse('2000000000015'),
    referenciaFabricante: 'REF-1',
    descricao: `Item ${codprod}`,
    marca: 'Marca inventada',
    nossoPreco: Centavos.parse(1234),
    ...mudancas,
  }
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
    assert.equal(await gravarCatalogo(dono, [item('1'), item('2')]), 2)
    const antes = await noBanco()
    assert.equal(await gravarCatalogo(dono, [item('1'), item('2')]), 2)
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
      nossoPreco: null,
    })
    const [antes] = await noBanco()
    assert.equal(await gravarCatalogo(dono, [mudado, item('3')]), 3)
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
    })
    assert.equal(id, antes.id)
    assert.ok(carregadoEm > antes.carregadoEm)
    // quem não veio nesta carga continua como estava
    assert.equal(segundo.nossoPrecoCentavos, 1234)
  })

  test('uma recusa não grava nada e não repete os dados do catálogo', async () => {
    const antes = await noBanco()
    // o mesmo codprod duas vezes na mesma carga é recusado pelo Postgres
    const repetido = gravarCatalogo(dono, [item('8'), item('9'), item('9')])
    await assert.rejects(repetido, (erro: Error) => {
      assert.equal(erro.message, 'não consegui gravar o catálogo: 21000')
      assert.doesNotMatch(inspect(erro), /Item 9|Marca inventada/)
      return true
    })
    assert.deepEqual(await noBanco(), antes)
  })
})
