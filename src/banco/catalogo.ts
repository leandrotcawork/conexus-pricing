import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Grupo } from '../dominio/grupo.ts'
import { arvoreDeGrupos } from '../dominio/grupo.ts'
import type { ItemDoRecorte } from '../dominio/recorte.ts'
import type { Banco } from './conexao.ts'
import { grupo, produto } from './tabelas.ts'

const ErroDoPostgres = z.object({
  cause: z.object({ code: z.string(), constraint: z.string().optional() }),
})

/** O erro do Drizzle repete o comando e os valores, que são o catálogo: não vai adiante. */
function falha(erro: unknown): Error {
  const lido = ErroDoPostgres.safeParse(erro)
  const motivo = lido.success
    ? `${lido.data.cause.code} ${lido.data.cause.constraint ?? ''}`.trim()
    : 'sem resposta do Postgres'
  return new Error(`não consegui gravar o catálogo: ${motivo}`)
}

/** O protocolo do Postgres aceita até 65535 parâmetros por comando, e cada linha leva até 9. */
const LINHAS_POR_COMANDO = 5_000

function lotes<T>(linhas: readonly T[]): readonly T[][] {
  const quantos = Math.ceil(linhas.length / LINHAS_POR_COMANDO)
  return Array.from({ length: quantos }, (_, lote) =>
    linhas.slice(lote * LINHAS_POR_COMANDO, (lote + 1) * LINHAS_POR_COMANDO),
  )
}

/** O pai antes dos filhos: um lote não pode citar um grupo que só entra no seguinte. */
function paisPrimeiro(grupos: readonly Grupo[]): readonly Grupo[] {
  const arvore = arvoreDeGrupos(grupos)
  function fundo({ codigo }: Grupo): number {
    return arvore.ateARaiz(codigo).length
  }
  return grupos.toSorted((a, b) => fundo(a) - fundo(b))
}

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0]

async function gravarGrupos(tx: Transacao, grupos: readonly Grupo[]): Promise<void> {
  for (const lote of lotes(paisPrimeiro(grupos))) {
    await tx
      .insert(grupo)
      .values(lote)
      .onConflictDoUpdate({
        target: grupo.codigo,
        set: {
          nome: sql`excluded.nome`,
          pai: sql`excluded.pai`,
          grau: sql`excluded.grau`,
          analitico: sql`excluded.analitico`,
          ativo: sql`excluded.ativo`,
        },
      })
  }
}

async function gravarProdutos(tx: Transacao, itens: readonly ItemDoRecorte[]): Promise<void> {
  const linhas = itens.map(({ produto: { nossoPreco, grupo, ...resto }, classe, venda12m }) => ({
    ...resto,
    nossoPrecoCentavos: nossoPreco,
    grupoCodigo: grupo,
    classe,
    venda12mCentavos: venda12m,
  }))
  for (const lote of lotes(linhas)) {
    await tx
      .insert(produto)
      .values(lote)
      .onConflictDoUpdate({
        target: produto.codprod,
        set: {
          ean: sql`excluded.ean`,
          referenciaFabricante: sql`excluded.referencia_fabricante`,
          descricao: sql`excluded.descricao`,
          marca: sql`excluded.marca`,
          nossoPrecoCentavos: sql`excluded.nosso_preco_centavos`,
          grupoCodigo: sql`excluded.grupo_codigo`,
          classe: sql`excluded.classe`,
          venda12mCentavos: sql`excluded.venda_12m_centavos`,
          carregadoEm: sql`now()`,
        },
      })
  }
}

/**
 * Upsert dos grupos pelo código e dos produtos pelo codprod, numa transação só: ou entra tudo ou
 * nada, e repetir atualiza sem criar linha. Quem já está na tabela e não veio agora fica como está.
 * Devolve o total de produtos.
 */
export async function gravarCatalogo(
  banco: Banco,
  catalogo: { readonly grupos: readonly Grupo[]; readonly itens: readonly ItemDoRecorte[] },
): Promise<number> {
  try {
    return await banco.transaction(async (tx) => {
      await gravarGrupos(tx, catalogo.grupos)
      await gravarProdutos(tx, catalogo.itens)
      return await tx.$count(produto)
    })
  } catch (erro) {
    throw falha(erro)
  }
}
