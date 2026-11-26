import type { SQLWrapper } from 'drizzle-orm'
import { and, asc, count, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Grupo } from '../dominio/grupo.ts'
import type { RodadaId } from '../dominio/marcas.ts'
import { Centavos, CodGrupo, Codprod, Ean, ProdutoId } from '../dominio/marcas.ts'
import type { Banco } from './conexao.ts'
import { grupo, observacao, produto } from './tabelas.ts'

const LinhaDoProduto = z.object({
  id: ProdutoId,
  codprod: Codprod,
  ean: Ean,
  descricao: z.string(),
  marca: z.string().nullable(),
  grupo: CodGrupo.nullable(),
  nossoPreco: Centavos.nullable(),
  venda12m: z.number().int().nonnegative().nullable(),
})

export type ProdutoLido = z.infer<typeof LinhaDoProduto>

const COLUNAS_DO_PRODUTO = {
  id: produto.id,
  codprod: produto.codprod,
  ean: produto.ean,
  descricao: produto.descricao,
  marca: produto.marca,
  grupo: produto.grupoCodigo,
  nossoPreco: produto.nossoPrecoCentavos,
  venda12m: produto.venda12mCentavos,
}

/** Os filtros informados valem juntos. */
export type Busca = {
  readonly texto?: string | undefined
  readonly marca?: string | undefined
  readonly codprods?: readonly Codprod[] | undefined
  readonly eans?: readonly Ean[] | undefined
  /** Os códigos já com os subgrupos. */
  readonly grupos?: readonly CodGrupo[] | undefined
}

export type ProdutoRef = { readonly codprod: Codprod } | { readonly ean: Ean }

const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucn'

function semCaixaNemAcento(valor: SQLWrapper) {
  return sql`translate(lower(${valor}), ${COM_ACENTO}, ${SEM_ACENTO})`
}

// strpos e não LIKE: `%` e `_` do pedido valem como texto
function contem(coluna: SQLWrapper, trecho: string) {
  const procurado = semCaixaNemAcento(sql`${trecho}::text`)
  return sql`strpos(${semCaixaNemAcento(coluna)}, ${procurado}) > 0`
}

function filtros({ texto, marca, codprods, eans, grupos }: Busca) {
  const palavras = texto?.split(/\s+/) ?? []
  return [
    ...palavras.map((palavra) => contem(produto.descricao, palavra)),
    marca === undefined ? undefined : contem(produto.marca, marca),
    codprods && inArray(produto.codprod, [...codprods]),
    eans && inArray(produto.ean, [...eans]),
    grupos && inArray(produto.grupoCodigo, [...grupos]),
  ]
}

export type Pagina = {
  readonly busca: Busca
  readonly depoisDe?: number
  readonly limite?: number
}

/** Em ordem de id, que nunca muda: a página seguinte começa depois do último id visto. */
export async function buscarProdutos(banco: Banco, { busca, depoisDe = 0, limite }: Pagina) {
  const consulta = banco
    .select(COLUNAS_DO_PRODUTO)
    .from(produto)
    .where(and(gt(produto.id, depoisDe), ...filtros(busca)))
    .orderBy(asc(produto.id))
  const linhas = await (limite === undefined ? consulta : consulta.limit(limite))
  return z.array(LinhaDoProduto).parse(linhas)
}

/** Os produtos de qualquer um dos pedidos; um EAN pode estar em mais de um produto. */
export async function produtosDe(banco: Banco, refs: readonly ProdutoRef[]) {
  const codprods = refs.flatMap((ref) => ('codprod' in ref ? [ref.codprod] : []))
  const eans = refs.flatMap((ref) => ('ean' in ref ? [ref.ean] : []))
  const linhas = await banco
    .select(COLUNAS_DO_PRODUTO)
    .from(produto)
    .where(or(inArray(produto.codprod, codprods), inArray(produto.ean, eans)))
    .orderBy(asc(produto.id))
  return z.array(LinhaDoProduto).parse(linhas)
}

const LinhaDoGrupo = z.object({
  codigo: CodGrupo,
  nome: z.string(),
  pai: CodGrupo.nullable(),
  grau: z.number().int(),
  analitico: z.boolean(),
  ativo: z.boolean(),
})

/** A árvore inteira: é pequena, e quem a percorre é o domínio. */
export async function gruposDe(banco: Banco): Promise<readonly Grupo[]> {
  return z.array(LinhaDoGrupo).parse(await banco.select().from(grupo))
}

const LinhaDaContagem = z.object({
  grupo: CodGrupo.nullable(),
  produtos: z.number().int(),
  comPreco: z.number().int(),
})

/** Quantos produtos cada grupo tem direto, e quantos têm um preço `OK` nas rodadas dadas. */
export async function contarPorGrupo(banco: Banco, rodadas: readonly RodadaId[]) {
  const precificados = banco
    .selectDistinct({ produtoId: observacao.produtoId })
    .from(observacao)
    .where(and(inArray(observacao.rodadaId, [...rodadas]), eq(observacao.situacao, 'OK')))
    .as('precificados')
  const linhas = await banco
    .select({
      grupo: produto.grupoCodigo,
      produtos: count(),
      comPreco: count(precificados.produtoId),
    })
    .from(produto)
    .leftJoin(precificados, eq(precificados.produtoId, produto.id))
    .groupBy(produto.grupoCodigo)
  return z.array(LinhaDaContagem).parse(linhas)
}
