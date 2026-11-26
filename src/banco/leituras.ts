/** As consultas das ferramentas MCP. O SQL só traz linhas; quem calcula é o domínio. */
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Cotacao } from '../dominio/indicadores.ts'
import { Centavos, FonteCodigo, ProdutoId, RodadaId } from '../dominio/marcas.ts'
import { SITUACOES_OBSERVACAO } from '../dominio/observacao.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco } from './conexao.ts'
import type { Pagina, ProdutoRef } from './leituras-do-catalogo.ts'
import { buscarProdutos, contarPorGrupo, gruposDe, produtosDe } from './leituras-do-catalogo.ts'
import { contar } from './rodadas.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

export type { ProdutoLido, ProdutoRef } from './leituras-do-catalogo.ts'

/** Só a rodada que fechou valendo dá preço; as outras aparecem na saúde da coleta. */
const COM_PRECOS = ['CONCLUIDA', 'SUSPEITA'] as const

const LinhaDaLoja = z.object({ loja: FonteCodigo, nome: z.string() })

async function lojasAtivasDe(banco: Banco) {
  const linhas = await banco
    .select({ loja: fonte.codigo, nome: fonte.nome })
    .from(fonte)
    .where(eq(fonte.ativa, true))
    .orderBy(asc(fonte.codigo))
  return z.array(LinhaDaLoja).parse(linhas)
}

const LinhaDaRodada = z.object({
  id: RodadaId,
  loja: FonteCodigo,
  agendadaPara: z.date(),
  situacao: z.enum(COM_PRECOS),
})

export type RodadaComPrecos = z.infer<typeof LinhaDaRodada>

async function rodadasComPrecosDe(banco: Banco) {
  const linhas = await banco
    .select({
      id: rodada.id,
      loja: fonte.codigo,
      agendadaPara: rodada.agendadaPara,
      situacao: rodada.situacao,
    })
    .from(rodada)
    .innerJoin(fonte, eq(fonte.id, rodada.fonteId))
    .where(and(eq(fonte.ativa, true), inArray(rodada.situacao, COM_PRECOS)))
  return z.array(LinhaDaRodada).parse(linhas)
}

export type Recorte = {
  readonly rodadas: readonly RodadaId[]
  /** Sem a lista, o catálogo inteiro. */
  readonly produtos?: readonly ProdutoId[] | undefined
}

function doRecorte({ rodadas, produtos }: Recorte) {
  return and(
    inArray(observacao.rodadaId, [...rodadas]),
    produtos && inArray(observacao.produtoId, [...produtos]),
  )
}

const DaObservacao = { rodadaId: RodadaId, produtoId: ProdutoId }

// só o OK carrega preço: um sem estoque publica preço, e ele não entra em indicador
const LinhaDaCotacao = z.discriminatedUnion('situacao', [
  z.object({
    ...DaObservacao,
    situacao: z.literal('OK'),
    preco: Centavos,
    precoLista: Centavos.nullable(),
  }),
  z.object({ ...DaObservacao, situacao: z.enum(SITUACOES_OBSERVACAO).exclude(['OK']) }),
])

async function cotacoesDe(
  banco: Banco,
  recorte: Recorte & { readonly lojas: ReadonlyMap<RodadaId, FonteCodigo> },
) {
  const linhas = await banco
    .select({
      rodadaId: observacao.rodadaId,
      produtoId: observacao.produtoId,
      situacao: observacao.situacao,
      preco: observacao.precoCentavos,
      precoLista: observacao.precoListaCentavos,
    })
    .from(observacao)
    .where(doRecorte(recorte))
  return z
    .array(LinhaDaCotacao)
    .parse(linhas)
    .flatMap(({ rodadaId, produtoId, ...dita }) => {
      const loja = recorte.lojas.get(rodadaId)
      const cotacao: Cotacao | undefined = loja && { loja, ...dita }
      return cotacao ? [{ rodadaId, produtoId, cotacao }] : []
    })
}

const LinhaDaObservacao = z.object({
  ...DaObservacao,
  situacao: z.enum(SITUACOES_OBSERVACAO),
  preco: Centavos.nullable(),
  precoLista: Centavos.nullable(),
  vendedor: z.string().nullable(),
  url: z.string().nullable(),
  detalhe: z.string().nullable(),
  coletadoEm: z.date(),
})

async function observacoesDe(banco: Banco, recorte: Recorte) {
  const linhas = await banco
    .select({
      rodadaId: observacao.rodadaId,
      produtoId: observacao.produtoId,
      situacao: observacao.situacao,
      preco: observacao.precoCentavos,
      precoLista: observacao.precoListaCentavos,
      vendedor: observacao.vendedor,
      url: observacao.url,
      detalhe: observacao.detalhe,
      coletadoEm: observacao.coletadoEm,
    })
    .from(observacao)
    .where(doRecorte(recorte))
  return z.array(LinhaDaObservacao).parse(linhas)
}

async function okPorLoja(banco: Banco): Promise<ReadonlyMap<FonteCodigo, number>> {
  const linhas = await banco
    .selectDistinctOn([rodada.fonteId], { id: rodada.id, loja: fonte.codigo })
    .from(rodada)
    .innerJoin(fonte, eq(fonte.id, rodada.fonteId))
    .where(inArray(rodada.situacao, COM_PRECOS))
    .orderBy(rodada.fonteId, desc(rodada.agendadaPara))
  const contadas = await Promise.all(
    linhas.map(async ({ id, loja }) => {
      const { OK } = await contar(banco, RodadaId.parse(id))
      return [FonteCodigo.parse(loja), OK] as const
    }),
  )
  return new Map(contadas)
}

/** Cada loja, ativa ou não, com a rodada de agendamento mais novo em qualquer situação. */
async function ultimasRodadasDe(banco: Banco, loja: FonteCodigo | undefined) {
  const ultima = banco
    .selectDistinctOn([rodada.fonteId])
    .from(rodada)
    .orderBy(rodada.fonteId, desc(rodada.agendadaPara))
    .as('ultima')
  const linhas = await banco
    .select({
      loja: fonte.codigo,
      nome: fonte.nome,
      ativa: fonte.ativa,
      rodada: {
        id: ultima.id,
        situacao: ultima.situacao,
        agendadaPara: ultima.agendadaPara,
        iniciadaEm: ultima.iniciadaEm,
        concluidaEm: ultima.concluidaEm,
        avisos: ultima.avisos,
      },
    })
    .from(fonte)
    .leftJoin(ultima, eq(ultima.fonteId, fonte.id))
    .where(loja === undefined ? undefined : eq(fonte.codigo, loja))
    .orderBy(asc(fonte.codigo))
  const [catalogo, ok] = await Promise.all([banco.$count(produto), okPorLoja(banco)])
  return await Promise.all(
    linhas.map(async ({ rodada: lida, ...daLoja }) => ({
      ...daLoja,
      cobertura: { catalogo, ok: ok.get(FonteCodigo.parse(daLoja.loja)) ?? 0 },
      // contadas agora, e não as gravadas no fechamento: a rodada em andamento ainda não as tem
      rodada: lida && { ...lida, contagens: await contar(banco, RodadaId.parse(lida.id)) },
    })),
  )
}

/** As consultas das ferramentas MCP, num pool que entra com a role que só lê. */
export function abrirLeituras(urlDoBanco: string) {
  const banco = abrirBanco(urlDoBanco)
  return {
    buscar: (pagina: Pagina) => buscarProdutos(banco, pagina),
    produtos: (refs: readonly ProdutoRef[]) => produtosDe(banco, refs),
    grupos: () => gruposDe(banco),
    contarPorGrupo: (rodadas: readonly RodadaId[]) => contarPorGrupo(banco, rodadas),
    lojasAtivas: () => lojasAtivasDe(banco),
    rodadasComPrecos: () => rodadasComPrecosDe(banco),
    cotacoes: (recorte: Parameters<typeof cotacoesDe>[1]) => cotacoesDe(banco, recorte),
    observacoes: (recorte: Recorte) => observacoesDe(banco, recorte),
    ultimasRodadas: (loja: FonteCodigo | undefined) => ultimasRodadasDe(banco, loja),
  }
}

export type Leituras = ReturnType<typeof abrirLeituras>
