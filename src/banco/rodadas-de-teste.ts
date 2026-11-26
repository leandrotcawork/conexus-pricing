import assert from 'node:assert/strict'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

export const A = '2000000000011'
export const B = '2000000000012'
export const SEM_PRODUTO = '2000000000008'
export const RESERVA = 'tcs_reserva_inventada_0000000000'

export const CATALOGO = [
  ['1', A],
  ['2', B],
  ['3', SEM_PRODUTO],
  ['4', A],
] as const

function consultas(dono: Banco) {
  function observacoes() {
    return dono
      .select({
        codprod: produto.codprod,
        situacao: observacao.situacao,
        preco: observacao.precoCentavos,
        precoLista: observacao.precoListaCentavos,
        cadastros: observacao.cadastros,
        detalhe: observacao.detalhe,
      })
      .from(observacao)
      .innerJoin(produto, eq(produto.id, observacao.produtoId))
      .orderBy(asc(produto.codprod))
  }
  return {
    observacoes,
    rodadas: () => dono.select().from(rodada).orderBy(asc(rodada.agendadaPara)),
    async situacoes() {
      return (await observacoes()).map(({ codprod, situacao, preco }) => [codprod, situacao, preco])
    },
    async deixarRodando(parada: {
      readonly agendadaPara: string
      readonly minutosSemSinal: number
    }) {
      const [loja] = await dono.select().from(fonte).where(eq(fonte.codigo, 'telhanorte'))
      assert.ok(loja)
      const sinal = sql`now() - make_interval(mins => ${parada.minutosSemSinal})`
      const [aberta] = await dono
        .insert(rodada)
        .values({
          fonteId: loja.id,
          agendadaPara: new Date(parada.agendadaPara),
          situacao: 'RODANDO',
          iniciadaEm: sinal,
          sinalEm: sinal,
          contagens: {},
          avisos: [],
          versao: 'anterior',
        })
        .returning()
      const [item] = await dono.select().from(produto).where(eq(produto.codprod, '2'))
      assert.ok(aberta && item)
      await dono
        .insert(observacao)
        .values({ rodadaId: aberta.id, produtoId: item.id, situacao: 'SEM_PRECO' })
    },
  }
}

export async function abrirBancoDeRodada(urlBase: string) {
  const descartavel = await criarBancoDescartavel(urlBase)
  await descartavel.migrar()
  const dono = abrirBanco(descartavel.urls.dono)
  await dono
    .insert(produto)
    .values(
      CATALOGO.map(([codprod, ean]) => ({ codprod, ean, descricao: `Item de teste ${codprod}` })),
    )
  async function darTokenReservaAAbc(): Promise<void> {
    const reserva = JSON.stringify({ tokenReserva: RESERVA })
    await dono
      .update(fonte)
      .set({ config: sql`${fonte.config} || ${reserva}::jsonb` })
      .where(eq(fonte.codigo, 'abc'))
  }
  return {
    dono,
    ...consultas(dono),
    urlDoColetor: descartavel.urls.coletor,
    darTokenReservaAAbc,
    /** Mais produtos, cada um com o seu EAN, até o fim do `await using`. */
    async crescerCatalogo(quantos: number) {
      const itens = Array.from({ length: quantos }, (_, indice) => ({
        codprod: String(100 + indice),
        ean: String(2_000_000_100_000 + indice),
        descricao: `Item extra ${indice + 1}`,
      }))
      const criados = await dono.insert(produto).values(itens).returning({ id: produto.id })
      const ids = criados.map((criado) => criado.id)
      return {
        async [Symbol.asyncDispose](): Promise<void> {
          await dono.delete(rodada)
          await dono.delete(produto).where(inArray(produto.id, ids))
        },
      }
    },
    async limpar(): Promise<void> {
      await dono.delete(rodada)
      await dono.update(fonte).set({ ativa: true })
      await darTokenReservaAAbc()
    },
    async apagar(): Promise<void> {
      await fecharBanco(dono)
      await descartavel.apagar()
    },
  }
}
