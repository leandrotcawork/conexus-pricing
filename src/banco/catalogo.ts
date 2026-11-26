import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ProdutoDoCatalogo } from '../dominio/recorte.ts'
import type { Banco } from './conexao.ts'
import { produto } from './tabelas.ts'

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

/** O protocolo do Postgres aceita até 65535 parâmetros por comando, e cada linha leva 6. */
const LINHAS_POR_COMANDO = 5_000

/**
 * Upsert por codprod em lotes numa transação só: ou entra tudo ou nada, e repetir atualiza sem
 * criar linha. Quem já está na tabela e não veio agora fica como está. Devolve o total de linhas.
 */
export async function gravarCatalogo(
  banco: Banco,
  produtos: readonly ProdutoDoCatalogo[],
): Promise<number> {
  const linhas = produtos.map(({ nossoPreco, ...resto }) => ({
    ...resto,
    nossoPrecoCentavos: nossoPreco,
  }))
  try {
    return await banco.transaction(async (tx) => {
      for (let inicio = 0; inicio < linhas.length; inicio += LINHAS_POR_COMANDO) {
        await tx
          .insert(produto)
          .values(linhas.slice(inicio, inicio + LINHAS_POR_COMANDO))
          .onConflictDoUpdate({
            target: produto.codprod,
            set: {
              ean: sql`excluded.ean`,
              referenciaFabricante: sql`excluded.referencia_fabricante`,
              descricao: sql`excluded.descricao`,
              marca: sql`excluded.marca`,
              nossoPrecoCentavos: sql`excluded.nosso_preco_centavos`,
              carregadoEm: sql`now()`,
            },
          })
      }
      return await tx.$count(produto)
    })
  } catch (erro) {
    throw falha(erro)
  }
}
