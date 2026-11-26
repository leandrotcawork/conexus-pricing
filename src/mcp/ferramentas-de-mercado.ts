import { z } from 'zod'
import { FonteCodigo } from '../dominio/marcas.ts'
import { AGRUPAMENTOS, ORDENACOES } from '../dominio/panorama.ts'
import {
  CodGrupoPedido,
  Instante,
  LOTE,
  ProdutoRef,
  SituacaoAtual,
  SituacaoDaRodada,
} from './comuns.ts'

// strictObject: um pedido com duas formas é recusado, e não lido pela primeira que servir
const Escopo = z.union([
  z.strictObject({ produtos: z.array(ProdutoRef).min(1).max(LOTE) }),
  z.strictObject({ grupo: CodGrupoPedido }),
  z.strictObject({ marca: z.string().trim().min(1) }),
  z.strictObject({ catalogo: z.literal(true) }),
])

const Pct = z.number() // duas casas, positivo = nós acima

const Linha = z.object({
  chave: z.string().describe('codprod, código do grupo, marca ou loja, conforme agruparPor.'),
  nome: z.string(),
  cobertura: z
    .object({ produtos: z.number().int(), comPreco: z.number().int() })
    .describe('Produtos da linha e quantos têm preço de concorrente.'),
  indice: z
    .number()
    .nullable()
    .describe('nosso ÷ mediana das lojas × 100; agregado: média simples.'),
  indicePonderado: z
    .number()
    .nullable()
    .describe('idem, ponderado pela venda líquida de 12 meses.'),
  gapMenorPct: Pct.nullable().describe('(nosso − menor) ÷ menor, em %; agregado: média simples.'),
  posicao: z.enum(['MAIS_BARATO', 'NA_FAIXA', 'MAIS_CARO']).nullable().describe('Só por produto.'),
  menorPrecoPct: z
    .number()
    .nullable()
    .describe(
      '% dos produtos com preço em que somos o mais barato. Na linha de uma loja, % dos ' +
        'produtos dela em que ela tem o menor preço entre as lojas.',
    ),
  amplitudePct: Pct.nullable().describe(
    '(máximo − mínimo) ÷ mínimo entre as lojas, só com 3 ou mais; agregado: mediana.',
  ),
  emPromocao: z.number().int().describe('Observações com preço abaixo do preço de lista.'),
  rupturaPct: z
    .number()
    .nullable()
    .describe('% das observações SEM_ESTOQUE; as com ERRO não contam.'),
  mudancas: z
    .object({
      subiram: z.number().int(),
      desceram: z.number().int(),
      tamanhoMedioPct: Pct.nullable().describe('Média, em módulo, do que mudou.'),
    })
    .nullable()
    .describe(
      'Cada par produto e loja contra a coleta anterior da loja, de outra semana; null com menos ' +
        'de 4 semanas de coleta ou sem par para comparar.',
    ),
  tendencia: z
    .object({ variacaoPct: Pct, inclinacaoPctSemana: Pct })
    .nullable()
    .describe(
      'Do índice nas 8 semanas mais novas, com o nosso preço de hoje: as 4 recentes contra as 4 ' +
        'anteriores, e a inclinação em % por semana; null sem índice nas 8.',
    ),
})

export const panoramaPrecos = {
  nome: 'panorama_precos',
  titulo: 'Panorama de preços',
  descricao:
    'Indicadores prontos contra a concorrência para produtos, um grupo, uma marca ou o catálogo, ' +
    'por produto, grupo ou loja: índice (nosso ÷ mediana × 100), gap para o menor, posição, ' +
    'cobertura, share de menor preço, promoção, ruptura, mudanças e tendência. Só entram preços ' +
    'OK. Indicador sem base suficiente vem null; semanasComColeta diz quanto histórico há, e ' +
    'historico avisa quando ainda não há semanas suficientes para mudanças ou tendência.',
  entrada: z.object({
    escopo: Escopo,
    agruparPor: z.enum(AGRUPAMENTOS).default('produto'),
    ordenarPor: z
      .enum(ORDENACOES)
      .optional()
      .describe('Do maior para o menor; as linhas sem o indicador ficam no fim.'),
    limite: z.number().int().min(1).max(LOTE).default(20),
    continuacao: z.string().min(1).optional(),
  }),
  saida: z.object({
    semanasComColeta: z.number().int(),
    historico: z
      .string()
      .nullable()
      .describe('Diz o que ainda não tem semanas suficientes; null quando há para tudo.'),
    total: Linha.omit({ chave: true, nome: true, posicao: true }),
    linhas: z.array(Linha),
    naoEncontrados: z.array(z.string()),
    continuacao: z.string().nullable().describe('null na última página.'),
  }),
} as const

export const saudeColeta = {
  nome: 'saude_coleta',
  titulo: 'Saúde da coleta',
  descricao:
    'Última rodada de cada loja: situação, contagens por situação, avisos e idade, e a cobertura ' +
    '(quantos produtos do catálogo a loja tem à venda). Mostra se a coleta da semana está ' +
    'saudável e separa produto que a loja não vende (NAO_ENCONTRADO) de falha de coleta (ERRO).',
  entrada: z.object({ loja: FonteCodigo.optional() }),
  saida: z.object({
    lojas: z.array(
      z.object({
        loja: z.string(),
        nome: z.string(),
        ativa: z.boolean(),
        cobertura: z
          .object({ catalogo: z.number().int(), ok: z.number().int() })
          .describe('ok: produtos com preço OK na última rodada CONCLUIDA ou SUSPEITA.'),
        ultimaRodada: z
          .object({
            agendadaPara: Instante,
            situacao: SituacaoDaRodada,
            iniciadaEm: Instante,
            concluidaEm: Instante.nullable(),
            contagens: z.record(SituacaoAtual, z.number().int()),
            avisos: z.array(z.string()),
            idadeHoras: z
              .number()
              .describe('Horas desde que a rodada fechou, ou desde o início se ainda roda.'),
          })
          .nullable()
          .describe('null: a loja nunca teve rodada.'),
      }),
    ),
  }),
} as const
