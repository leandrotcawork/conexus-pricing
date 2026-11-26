import assert from 'node:assert/strict'
import { notInArray } from 'drizzle-orm'
import type { Aviso, SituacaoRodada } from '../dominio/rodada.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { fonte, grupo, observacao, produto, rodada } from './tabelas.ts'

export type Observada = Omit<
  typeof observacao.$inferInsert,
  'rodadaId' | 'produtoId' | 'coletadoEm'
>

export type RodadaDeTeste = {
  readonly loja: string
  readonly em: Date
  readonly situacao: SituacaoRodada
  readonly avisos?: readonly Aviso[]
  /** Por codprod. */
  readonly observadas: Readonly<Record<string, Observada>>
}

type Semente = {
  readonly grupos?: readonly (typeof grupo.$inferInsert)[]
  readonly produtos: readonly (typeof produto.$inferInsert)[]
  readonly fontes?: readonly (typeof fonte.$inferInsert)[]
  readonly todasAsLojas?: boolean
}

export function ok(precoCentavos: number): Observada {
  return { situacao: 'OK', precoCentavos }
}

async function gravarRodada(dono: Banco, pedida: RodadaDeTeste): Promise<void> {
  const lojas = await dono.select().from(fonte)
  const produtos = await dono.select().from(produto)
  const { em } = pedida
  const loja = lojas.find(({ codigo }) => codigo === pedida.loja)
  assert.ok(loja)
  const [criada] = await dono
    .insert(rodada)
    .values({
      fonteId: loja.id,
      agendadaPara: em,
      situacao: pedida.situacao,
      iniciadaEm: em,
      sinalEm: em,
      concluidaEm: pedida.situacao === 'RODANDO' ? null : em,
      contagens: {},
      avisos: pedida.avisos ?? [],
      versao: 'teste',
    })
    .returning({ id: rodada.id })
  assert.ok(criada)
  await dono.insert(observacao).values(
    Object.entries(pedida.observadas).map(([codprod, observada]) => {
      const item = produtos.find((p) => p.codprod === codprod)
      assert.ok(item)
      return { ...observada, rodadaId: criada.id, produtoId: item.id, coletadoEm: em }
    }),
  )
}

/** As lojas das migrações que ficam: uma loja nova não muda o que os testes de leitura esperam. */
const LOJAS_DA_SEMENTE = ['abc', 'condec', 'telhanorte']

/**
 * Um banco descartável com o catálogo dado e as fontes da semente. Das lojas das migrações ficam
 * três, salvo com `todasAsLojas`.
 */
export async function abrirBancoSemeado(urlBase: string, semente: Semente) {
  const descartavel = await criarBancoDescartavel(urlBase)
  await descartavel.migrar()
  const dono = abrirBanco(descartavel.urls.dono)
  if (!semente.todasAsLojas) {
    await dono.delete(fonte).where(notInArray(fonte.codigo, LOJAS_DA_SEMENTE))
  }
  if (semente.grupos) await dono.insert(grupo).values([...semente.grupos])
  await dono.insert(produto).values([...semente.produtos])
  if (semente.fontes) await dono.insert(fonte).values([...semente.fontes])
  return {
    urlDoLeitor: descartavel.urls.leitor,
    async lojas(): Promise<readonly string[]> {
      return (await dono.select().from(fonte)).map(({ codigo }) => codigo)
    },
    async gravar(rodadas: readonly RodadaDeTeste[]): Promise<void> {
      for (const pedida of rodadas) await gravarRodada(dono, pedida)
    },
    async apagar(): Promise<void> {
      await fecharBanco(dono)
      await descartavel.apagar()
    },
  }
}

/** Um lote cheio: 50 produtos, cada um com preço e preço de lista em todas as lojas das migrações. */
export async function abrirLoteCheio(urlBase: string) {
  const produtos = Array.from({ length: 50 }, (_, indice) => ({
    codprod: String(1001 + indice),
    ean: String(2_000_000_100_000 + indice),
    descricao: `PORCELANATO ESMALTADO RETIFICADO ACETINADO INTERNO 60X120 CM CAIXA ${indice + 1}`,
    nossoPrecoCentavos: 123_456,
    venda12mCentavos: 987_654_321,
  }))
  const banco = await abrirBancoSemeado(urlBase, { produtos, todasAsLojas: true })
  const lojas = await banco.lojas()
  const observada = { ...ok(1_234_567), precoListaCentavos: 1_500_099 }
  const observadas = Object.fromEntries(produtos.map(({ codprod }) => [codprod, observada]))
  const em = new Date('2026-10-28T12:00:00Z')
  await banco.gravar(lojas.map((loja) => ({ loja, em, situacao: 'CONCLUIDA', observadas })))
  return { ...banco, lojas, produtos: produtos.map(({ codprod }) => ({ codprod })) }
}
