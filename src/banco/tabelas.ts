import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { PLATAFORMAS } from '../dominio/fonte.ts'
import { SITUACOES_OBSERVACAO } from '../dominio/observacao.ts'
import { CLASSES } from '../dominio/recorte.ts'
import type { Aviso, Contagens } from '../dominio/rodada.ts'
import { SITUACOES_RODADA } from '../dominio/rodada.ts'

/** Dinheiro em centavos inteiros (data D15). Acrescentar situação é migração só de adição (D6). */
export const precos = pgSchema('precos')

export const plataforma = precos.enum('plataforma', PLATAFORMAS)
export const situacaoRodada = precos.enum('situacao_rodada', SITUACOES_RODADA)
export const situacaoObservacao = precos.enum('situacao_observacao', SITUACOES_OBSERVACAO)
export const classe = precos.enum('classe', CLASSES)

function instante(nome: string) {
  return timestamp(nome, { withTimezone: true })
}

export const grupo = precos.table(
  'grupo',
  {
    // o CODGRUPOPROD do Sankhya é a chave
    codigo: integer('codigo').primaryKey(),
    nome: text('nome').notNull(),
    pai: integer('pai'),
    grau: integer('grau').notNull(),
    analitico: boolean('analitico').notNull(),
    ativo: boolean('ativo').notNull(),
  },
  (t) => [
    foreignKey({ name: 'grupo_pai_existe', columns: [t.pai], foreignColumns: [t.codigo] }).onDelete(
      'restrict',
    ),
  ],
)

export const produto = precos.table(
  'produto',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    codprod: text('codprod').notNull().unique('produto_um_por_codprod'),
    ean: text('ean').notNull(),
    referenciaFabricante: text('referencia_fabricante'),
    descricao: text('descricao').notNull(),
    marca: text('marca'),
    nossoPrecoCentavos: integer('nosso_preco_centavos'),
    grupoCodigo: integer('grupo_codigo').references(() => grupo.codigo, { onDelete: 'restrict' }),
    classe: classe('classe'),
    // um ano de venda de um produto passa do limite do integer
    venda12mCentavos: bigint('venda_12m_centavos', { mode: 'number' }),
    carregadoEm: instante('carregado_em').notNull().defaultNow(),
  },
  (t) => [
    check('produto_ean_valido', sql`${t.ean} ~ '^[0-9]{8,14}$'`),
    check('produto_nosso_preco_positivo', sql`${t.nossoPrecoCentavos} > 0`),
    check('produto_venda_12m_nao_negativa', sql`${t.venda12mCentavos} >= 0`),
  ],
)

export const fonte = precos.table(
  'fonte',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    codigo: text('codigo').notNull().unique('fonte_um_por_codigo'),
    nome: text('nome').notNull(),
    plataforma: plataforma('plataforma').notNull(),
    config: jsonb('config').$type<unknown>().notNull(),
    ativa: boolean('ativa').notNull().default(true),
  },
  (t) => [check('fonte_codigo_valido', sql`${t.codigo} ~ '^[a-z][a-z0-9]{1,19}$'`)],
)

export const rodada = precos.table(
  'rodada',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fonteId: integer('fonte_id')
      .notNull()
      .references(() => fonte.id, { onDelete: 'restrict' }),
    agendadaPara: instante('agendada_para').notNull(),
    situacao: situacaoRodada('situacao').notNull(),
    iniciadaEm: instante('iniciada_em').notNull(),
    sinalEm: instante('sinal_em').notNull(),
    concluidaEm: instante('concluida_em'),
    contagens: jsonb('contagens').$type<Partial<Contagens>>().notNull(),
    avisos: jsonb('avisos').$type<readonly Aviso[]>().notNull(),
    versao: text('versao').notNull(),
  },
  (t) => [
    // a chave de idempotência: o Neon reentrega o mesmo horário agendado quando refaz
    unique('rodada_uma_por_agendamento').on(t.fonteId, t.agendadaPara),
    check(
      'rodada_aberta_so_rodando',
      sql`(${t.situacao} = 'RODANDO') = (${t.concluidaEm} IS NULL)`,
    ),
  ],
)

export const observacao = precos.table(
  'observacao',
  {
    rodadaId: integer('rodada_id')
      .notNull()
      .references(() => rodada.id, { onDelete: 'cascade' }),
    produtoId: integer('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    situacao: situacaoObservacao('situacao').notNull(),
    precoCentavos: integer('preco_centavos'),
    precoListaCentavos: integer('preco_lista_centavos'),
    vendedor: text('vendedor'),
    url: text('url'),
    detalhe: text('detalhe'),
    cadastros: integer('cadastros'),
    coletadoEm: instante('coletado_em').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'observacao_pk', columns: [t.rodadaId, t.produtoId] }),
    index('observacao_produto_idx').on(t.produtoId),
    check('observacao_preco_positivo', sql`${t.precoCentavos} > 0 AND ${t.precoListaCentavos} > 0`),
    // quem tem preço em cada situação é a união Observacao do domínio
    check(
      'observacao_com_preco_tem_preco',
      sql`${t.situacao} NOT IN ('OK', 'SEM_ESTOQUE') OR ${t.precoCentavos} IS NOT NULL`,
    ),
    check(
      'observacao_sem_preco_sem_valor',
      sql`${t.situacao} NOT IN ('SEM_PRECO', 'NAO_ENCONTRADO', 'ERRO') OR ${t.precoCentavos} IS NULL`,
    ),
    check(
      'observacao_preco_lista_so_no_ok',
      sql`${t.situacao} = 'OK' OR ${t.precoListaCentavos} IS NULL`,
    ),
    check('observacao_erro_tem_detalhe', sql`${t.situacao} <> 'ERRO' OR ${t.detalhe} IS NOT NULL`),
  ],
)
