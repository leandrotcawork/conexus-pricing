/** O banco dos testes da rodada: três lojas semeadas, quatro produtos e o que ficou gravado. */
import assert from 'node:assert/strict'
import { asc, eq, sql } from 'drizzle-orm'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

export const A = '2000000000011'
export const B = '2000000000012'
export const SEM_PRODUTO = '2000000000008'
export const RESERVA = 'tcs_reserva_inventada_0000000000'

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
    /** Uma rodada da Telha Norte ainda aberta, com o produto 2 já observado. */
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
  // o produto 4 repete o EAN do 1; o EAN do 3 nenhuma loja vende
  await dono.insert(produto).values(
    [A, B, SEM_PRODUTO, A].map((ean, indice) => ({
      codprod: String(indice + 1),
      ean,
      descricao: `Item de teste ${indice + 1}`,
    })),
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
    /** Sem rodadas, com as três lojas ativas e a ABC com um token reserva. */
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
