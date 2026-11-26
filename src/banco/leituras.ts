import type { SQLWrapper } from 'drizzle-orm'
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { SITUACAO_DAS_ESTATISTICAS } from '../dominio/estatisticas.ts'
import { Centavos, Codprod, Ean, FonteCodigo, ProdutoId, RodadaId } from '../dominio/marcas.ts'
import { SITUACOES_OBSERVACAO } from '../dominio/observacao.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco } from './conexao.ts'
import { contar } from './rodadas.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

/** Só a rodada que fechou valendo dá preço; as outras aparecem na saúde da coleta. */
const COM_PRECOS = ['CONCLUIDA', 'SUSPEITA'] as const

const LinhaDoProduto = z.object({
  id: ProdutoId,
  codprod: Codprod,
  ean: Ean,
  referenciaFabricante: z.string().nullable(),
  descricao: z.string(),
  marca: z.string().nullable(),
  nossoPreco: Centavos.nullable(),
})

const COLUNAS_DO_PRODUTO = {
  id: produto.id,
  codprod: produto.codprod,
  ean: produto.ean,
  referenciaFabricante: produto.referenciaFabricante,
  descricao: produto.descricao,
  marca: produto.marca,
  nossoPreco: produto.nossoPrecoCentavos,
}

export type Busca = {
  readonly texto?: string | undefined
  readonly ean?: Ean | undefined
  readonly codprod?: Codprod | undefined
  readonly marca?: string | undefined
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

function filtros({ texto, ean, codprod, marca }: Busca) {
  const palavras = texto?.split(/\s+/) ?? []
  return [
    ...palavras.map((palavra) => contem(produto.descricao, palavra)),
    marca === undefined ? undefined : contem(produto.marca, marca),
    ean === undefined ? undefined : eq(produto.ean, ean),
    codprod === undefined ? undefined : eq(produto.codprod, codprod),
  ]
}

/** Em ordem de id, que nunca muda: a página seguinte começa depois do último id visto. */
async function buscarProdutos(
  banco: Banco,
  pagina: { readonly busca: Busca; readonly depoisDe: number; readonly limite: number },
) {
  const linhas = await banco
    .select(COLUNAS_DO_PRODUTO)
    .from(produto)
    .where(and(gt(produto.id, pagina.depoisDe), ...filtros(pagina.busca)))
    .orderBy(asc(produto.id))
    .limit(pagina.limite)
  return z.array(LinhaDoProduto).parse(linhas)
}

/** Um EAN pode estar em mais de um produto do catálogo. */
async function produtosDe(banco: Banco, ref: ProdutoRef) {
  const linhas = await banco
    .select(COLUNAS_DO_PRODUTO)
    .from(produto)
    .where('codprod' in ref ? eq(produto.codprod, ref.codprod) : eq(produto.ean, ref.ean))
    .orderBy(asc(produto.id))
  return z.array(LinhaDoProduto).parse(linhas)
}

const LinhaAtual = z.object({
  loja: FonteCodigo,
  nome: z.string(),
  atual: z
    .object({
      situacao: z.enum(SITUACOES_OBSERVACAO),
      preco: Centavos.nullable(),
      precoLista: Centavos.nullable(),
      vendedor: z.string().nullable(),
      url: z.string().nullable(),
      detalhe: z.string().nullable(),
      coletadoEm: z.date(),
      agendadaPara: z.date(),
      rodada: z.enum(COM_PRECOS),
    })
    .nullable(),
})

export type LojaAtual = z.infer<typeof LinhaAtual>

/**
 * Por loja ativa, o que a última rodada com preços observou do produto. `atual` é null quando a
 * loja não tem essa rodada, ou o produto entrou no catálogo depois dela.
 */
async function precosAtuaisDe(banco: Banco, produtoId: ProdutoId) {
  const ultima = banco
    .selectDistinctOn([rodada.fonteId], {
      id: rodada.id,
      fonteId: rodada.fonteId,
      agendadaPara: rodada.agendadaPara,
      situacao: rodada.situacao,
    })
    .from(rodada)
    .where(inArray(rodada.situacao, COM_PRECOS))
    .orderBy(rodada.fonteId, desc(rodada.agendadaPara))
    .as('ultima')
  const linhas = await banco
    .select({
      loja: fonte.codigo,
      nome: fonte.nome,
      observada: {
        situacao: observacao.situacao,
        preco: observacao.precoCentavos,
        precoLista: observacao.precoListaCentavos,
        vendedor: observacao.vendedor,
        url: observacao.url,
        detalhe: observacao.detalhe,
        coletadoEm: observacao.coletadoEm,
      },
      agendadaPara: ultima.agendadaPara,
      rodada: ultima.situacao,
    })
    .from(fonte)
    .leftJoin(ultima, eq(ultima.fonteId, fonte.id))
    .leftJoin(
      observacao,
      and(eq(observacao.rodadaId, ultima.id), eq(observacao.produtoId, produtoId)),
    )
    .where(eq(fonte.ativa, true))
    .orderBy(asc(fonte.codigo))
  return z.array(LinhaAtual).parse(
    linhas.map(({ loja, nome, observada, ...daRodada }) => ({
      loja,
      nome,
      atual: observada && { ...observada, ...daRodada },
    })),
  )
}

const LinhaDoHistorico = z.object({ loja: FonteCodigo, preco: Centavos, coletadoEm: z.date() })

/** Os preços das rodadas com preços desde `desde`, os mais novos primeiro. */
async function historicoDe(
  banco: Banco,
  pedido: { readonly produtoId: ProdutoId; readonly desde: Date },
) {
  const linhas = await banco
    .select({
      loja: fonte.codigo,
      preco: observacao.precoCentavos,
      coletadoEm: observacao.coletadoEm,
    })
    .from(observacao)
    .innerJoin(rodada, eq(rodada.id, observacao.rodadaId))
    .innerJoin(fonte, eq(fonte.id, rodada.fonteId))
    .where(
      and(
        eq(observacao.produtoId, pedido.produtoId),
        eq(observacao.situacao, SITUACAO_DAS_ESTATISTICAS),
        inArray(rodada.situacao, COM_PRECOS),
        gte(observacao.coletadoEm, pedido.desde),
      ),
    )
    .orderBy(desc(rodada.agendadaPara))
  return z.array(LinhaDoHistorico).parse(linhas)
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
  return await Promise.all(
    linhas.map(async ({ rodada: lida, ...daLoja }) => ({
      ...daLoja,
      // contadas agora, e não as gravadas no fechamento: a rodada em andamento ainda não as tem
      rodada: lida && { ...lida, contagens: await contar(banco, RodadaId.parse(lida.id)) },
    })),
  )
}

/** As consultas das ferramentas MCP, num pool que entra com a role que só lê. */
export function abrirLeituras(urlDoBanco: string) {
  const banco = abrirBanco(urlDoBanco)
  return {
    buscar: (pagina: Parameters<typeof buscarProdutos>[1]) => buscarProdutos(banco, pagina),
    produtos: (ref: ProdutoRef) => produtosDe(banco, ref),
    precosAtuais: (produtoId: ProdutoId) => precosAtuaisDe(banco, produtoId),
    historico: (pedido: Parameters<typeof historicoDe>[1]) => historicoDe(banco, pedido),
    ultimasRodadas: (loja: FonteCodigo | undefined) => ultimasRodadasDe(banco, loja),
  }
}

export type Leituras = ReturnType<typeof abrirLeituras>
