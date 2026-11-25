/** O que a coleta lê e grava no banco, com a role `precos_coletor`. */
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Fonte } from '../dominio/fonte.ts'
import { PLATAFORMAS } from '../dominio/fonte.ts'
import { Ean, FonteCodigo, FonteId, ProdutoId, RodadaId } from '../dominio/marcas.ts'
import type { Observacao } from '../dominio/observacao.ts'
import type { Aviso, Contagens } from '../dominio/rodada.ts'
import type { Banco } from './conexao.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

const LinhaDaFonte = z.object({
  id: FonteId,
  codigo: FonteCodigo,
  nome: z.string(),
  plataforma: z.enum(PLATAFORMAS),
  config: z.unknown(),
  ativa: z.boolean(),
})

export async function lerFonte(banco: Banco, codigo: FonteCodigo): Promise<Fonte | undefined> {
  const [linha] = await banco.select().from(fonte).where(eq(fonte.codigo, codigo))
  return linha && LinhaDaFonte.parse(linha)
}

type Tomada = {
  readonly tipo: 'TOMADA' | 'JA_CONCLUIDA' | 'EM_ANDAMENTO'
  readonly rodadaId: RodadaId
}

/** O sinal de uma rodada viva nunca fica mais velho que o limite de 15 minutos da função. */
const ORFA = sql`now() - interval '15 minutes'`

/**
 * Uma rodada por loja e horário agendado: cria, retoma a que falhou, foi interrompida ou ficou
 * órfã, e deixa como está a concluída e a que ainda roda. Uma só instrução decide quem a toma.
 */
export async function tomarRodada(
  banco: Banco,
  pedido: { readonly fonteId: FonteId; readonly agendadaPara: Date; readonly versao: string },
): Promise<Tomada> {
  const recomeco = { situacao: 'RODANDO', sinalEm: sql`now()`, avisos: [] } as const
  const [tomada] = await banco
    .insert(rodada)
    .values({ ...pedido, ...recomeco, iniciadaEm: sql`now()`, contagens: {} })
    .onConflictDoUpdate({
      target: [rodada.fonteId, rodada.agendadaPara],
      // os avisos recomeçam: o prazo esgotado da tentativa anterior deixa de valer
      set: { ...recomeco, concluidaEm: null, versao: pedido.versao },
      setWhere: or(
        inArray(rodada.situacao, ['FALHOU', 'INTERROMPIDA']),
        and(eq(rodada.situacao, 'RODANDO'), lt(rodada.sinalEm, ORFA)),
      ),
    })
    .returning({ id: rodada.id })
  if (tomada) return { tipo: 'TOMADA', rodadaId: RodadaId.parse(tomada.id) }
  const [existente] = await banco
    .select({ id: rodada.id, situacao: rodada.situacao })
    .from(rodada)
    .where(and(eq(rodada.fonteId, pedido.fonteId), eq(rodada.agendadaPara, pedido.agendadaPara)))
  if (!existente) throw new Error('a rodada em conflito sumiu')
  const concluida = existente.situacao === 'CONCLUIDA' || existente.situacao === 'SUSPEITA'
  return {
    tipo: concluida ? 'JA_CONCLUIDA' : 'EM_ANDAMENTO',
    rodadaId: RodadaId.parse(existente.id),
  }
}

const Pendente = z.object({ id: ProdutoId, ean: Ean })
export type ProdutoPendente = z.infer<typeof Pendente>

/** Os produtos que a rodada ainda não observou. É o que uma retomada pergunta. */
export async function produtosPendentes(
  banco: Banco,
  rodadaId: RodadaId,
): Promise<readonly ProdutoPendente[]> {
  const linhas = await banco
    .select({ id: produto.id, ean: produto.ean })
    .from(produto)
    .leftJoin(
      observacao,
      and(eq(observacao.produtoId, produto.id), eq(observacao.rodadaId, rodadaId)),
    )
    .where(isNull(observacao.produtoId))
    .orderBy(asc(produto.id))
  return z.array(Pendente).parse(linhas)
}

export type Observado = { readonly produtoId: ProdutoId; readonly observacao: Observacao }

function colunas(observada: Observacao) {
  switch (observada.situacao) {
    case 'OK': {
      const { preco, precoLista, ...resto } = observada
      return { ...resto, precoCentavos: preco, precoListaCentavos: precoLista }
    }
    case 'SEM_ESTOQUE': {
      const { preco, ...resto } = observada
      return { ...resto, precoCentavos: preco }
    }
    case 'SEM_PRECO':
    case 'NAO_ENCONTRADO':
    case 'ERRO':
      return observada
    default:
      return observada satisfies never
  }
}

function acrescentando(avisos: readonly Aviso[]) {
  return sql`${rodada.avisos} || ${JSON.stringify(avisos)}::jsonb`
}

/**
 * Grava um lote numa transação, com o sinal de que a rodada está viva. Gravar o mesmo produto
 * outra vez não muda nada: vale a primeira observação.
 */
export async function registrar(
  banco: Banco,
  lote: {
    readonly rodadaId: RodadaId
    readonly observados: readonly Observado[]
    readonly avisos: readonly Aviso[]
  },
): Promise<void> {
  const { rodadaId, observados, avisos } = lote
  await banco.transaction(async (tx) => {
    if (observados.length > 0) {
      const linhas = observados.map(({ produtoId, observacao: observada }) => ({
        rodadaId,
        produtoId,
        ...colunas(observada),
      }))
      await tx.insert(observacao).values(linhas).onConflictDoNothing()
    }
    await tx
      .update(rodada)
      .set({ sinalEm: sql`now()`, avisos: acrescentando(avisos) })
      .where(eq(rodada.id, rodadaId))
  })
}

export async function contar(banco: Banco, rodadaId: RodadaId): Promise<Contagens> {
  const linhas = await banco
    .select({ situacao: observacao.situacao, total: count() })
    .from(observacao)
    .where(eq(observacao.rodadaId, rodadaId))
    .groupBy(observacao.situacao)
  const contagens = { OK: 0, SEM_ESTOQUE: 0, SEM_PRECO: 0, NAO_ENCONTRADO: 0, ERRO: 0 }
  for (const { situacao, total } of linhas) contagens[situacao] = total
  return contagens
}

/** Os OK da última rodada concluída desta loja antes deste horário; null se não houve. */
export async function okDaUltimaConcluida(
  banco: Banco,
  { fonteId, antesDe }: { readonly fonteId: FonteId; readonly antesDe: Date },
): Promise<number | null> {
  const [anterior] = await banco
    .select({ contagens: rodada.contagens })
    .from(rodada)
    .where(
      and(
        eq(rodada.fonteId, fonteId),
        eq(rodada.situacao, 'CONCLUIDA'),
        lt(rodada.agendadaPara, antesDe),
      ),
    )
    .orderBy(desc(rodada.agendadaPara))
    .limit(1)
  return anterior?.contagens.OK ?? null
}

/** Fecha a rodada que ainda está rodando e devolve todos os avisos dela. */
export async function fecharRodada(
  banco: Banco,
  fecho: {
    readonly rodadaId: RodadaId
    readonly situacao: 'CONCLUIDA' | 'SUSPEITA' | 'FALHOU' | 'INTERROMPIDA'
    readonly contagens: Contagens
    readonly avisos: readonly Aviso[]
  },
): Promise<readonly Aviso[]> {
  const { rodadaId, situacao, contagens, avisos } = fecho
  const [fechada] = await banco
    .update(rodada)
    .set({
      situacao,
      contagens,
      avisos: acrescentando(avisos),
      sinalEm: sql`now()`,
      concluidaEm: sql`now()`,
    })
    .where(and(eq(rodada.id, rodadaId), eq(rodada.situacao, 'RODANDO')))
    .returning({ avisos: rodada.avisos })
  if (!fechada) throw new Error(`a rodada ${rodadaId} já não estava rodando`)
  return fechada.avisos
}
