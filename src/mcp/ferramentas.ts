import { z } from 'zod'
import { Codprod, Ean, FonteCodigo } from '../dominio/marcas.ts'
import { SITUACOES_OBSERVACAO } from '../dominio/observacao.ts'
import { SITUACOES_RODADA } from '../dominio/rodada.ts'

const ProdutoRef = z
  .union([z.strictObject({ codprod: Codprod }), z.strictObject({ ean: Ean })])
  .describe('O produto, pelo código interno (codprod) ou pelo EAN: um dos dois.')
const Reais = z.number().positive() // centavos / 100 na borda; nunca zero
const Instante = z.iso.datetime() // UTC (code C40)
const NossoPreco = Reais.nullable().describe('O nosso preço de tabela, em reais; null se não há.')

const SituacaoAtual = z
  .enum(SITUACOES_OBSERVACAO)
  .describe(
    'OK: à venda por este preço. SEM_ESTOQUE: indisponível, com o preço que a loja publica. ' +
      'SEM_PRECO: a loja publica o produto sem preço. NAO_ENCONTRADO: a loja não vende o ' +
      'produto. ERRO: a coleta falhou, e não se sabe o preço nem se a loja vende.',
  )

const SituacaoDaRodada = z
  .enum(SITUACOES_RODADA)
  .describe(
    'CONCLUIDA: terminou. SUSPEITA: terminou com menos da metade dos preços da anterior. ' +
      'FALHOU: não deu preço que valha; os avisos dizem por quê. INTERROMPIDA: o prazo acabou ' +
      'antes de perguntar tudo. RODANDO: em andamento.',
  )

export const buscarProduto = {
  nome: 'buscar_produto',
  titulo: 'Buscar produto',
  descricao:
    'Procura produtos do catálogo por texto da descrição, EAN, código interno ou marca. ' +
    'Informe ao menos um; os informados valem juntos. Texto e marca ignoram maiúsculas e ' +
    'acentos, e todas as palavras do texto precisam aparecer. Devolve 20 por página: para a ' +
    'seguinte, repita a mesma busca com a continuacao recebida.',
  entrada: z
    .object({
      texto: z.string().trim().min(2).optional(),
      ean: Ean.optional(),
      codprod: Codprod.optional(),
      marca: z.string().trim().min(1).optional(),
      continuacao: z.string().min(1).optional(),
    })
    .refine(
      (e) => e.texto ?? e.ean ?? e.codprod ?? e.marca,
      'informe texto, ean, codprod ou marca',
    ),
  saida: z.object({
    produtos: z.array(
      z.object({
        codprod: z.string(),
        ean: z.string(),
        descricao: z.string(),
        marca: z.string().nullable(),
        referenciaFabricante: z.string().nullable(),
        nossoPreco: NossoPreco,
      }),
    ),
    continuacao: z.string().nullable().describe('null na última página.'),
  }),
} as const

export const precosAtuais = {
  nome: 'precos_atuais',
  titulo: 'Preços atuais',
  descricao:
    'Preço de cada loja acompanhada para um produto, da última coleta concluída de cada loja. ' +
    'NAO_ENCONTRADO quer dizer que a loja não vende; ERRO, que a coleta falhou. Se uma coleta ' +
    'mais nova falhou, o preço continua o da anterior: veja rodada.agendadaPara e saude_coleta.',
  entrada: z.object({ produto: ProdutoRef }),
  saida: z.object({
    produto: z.object({
      codprod: z.string(),
      ean: z.string(),
      descricao: z.string(),
      nossoPreco: NossoPreco,
    }),
    lojas: z.array(
      z.object({
        loja: z.string(),
        nome: z.string(),
        situacao: SituacaoAtual,
        preco: Reais.nullable(),
        precoLista: Reais.nullable(),
        vendedor: z.string().nullable(),
        url: z.string().nullable(),
        detalhe: z.string().nullable().describe('O motivo, quando a situação é ERRO.'),
        coletadoEm: Instante,
        rodada: z.object({
          agendadaPara: Instante,
          situacao: SituacaoDaRodada.extract(['CONCLUIDA', 'SUSPEITA']),
        }),
      }),
    ),
    lojasSemColeta: z
      .array(z.string())
      .describe('Lojas acompanhadas sem coleta concluída que tenha perguntado este produto.'),
  }),
} as const

export const estatisticasPreco = {
  nome: 'estatisticas_preco',
  titulo: 'Estatísticas de preço',
  descricao:
    'Mínimo, máximo, média e mediana do preço entre as lojas, contra o nosso preço, e o ' +
    'comportamento de cada loja no período de dias pedido. Só entram preços à venda (OK); ' +
    'situacaoAtual diz por que uma loja ficou sem preço.',
  entrada: z.object({
    produto: ProdutoRef,
    dias: z.number().int().min(7).max(365).default(90),
  }),
  saida: z.object({
    atual: z.object({
      lojasComPreco: z.number().int(),
      minimo: Reais.nullable(),
      maximo: Reais.nullable(),
      media: Reais.nullable(),
      mediana: Reais.nullable(),
      nossoPreco: NossoPreco,
      nossoContraMedianaPct: z
        .number()
        .nullable()
        .describe('O nosso preço acima (positivo) ou abaixo (negativo) da mediana, em %.'),
    }),
    porLoja: z.array(
      z.object({
        loja: z.string(),
        situacaoAtual: SituacaoAtual.nullable().describe(
          'A situação na última coleta concluída; null se não há uma com este produto.',
        ),
        precoAtual: Reais.nullable(),
        mesmoPrecoDesde: Instante.nullable().describe(
          'Primeira coleta, dentro do período, da sequência de preços iguais ao atual.',
        ),
        minimoNoPeriodo: Reais.nullable(),
        maximoNoPeriodo: Reais.nullable(),
      }),
    ),
  }),
} as const

export const saudeColeta = {
  nome: 'saude_coleta',
  titulo: 'Saúde da coleta',
  descricao:
    'Última rodada de cada loja: situação, contagens por situação, avisos e idade. Mostra se a ' +
    'coleta da semana está saudável e separa produto que a loja não vende (NAO_ENCONTRADO) de ' +
    'falha de coleta (ERRO).',
  entrada: z.object({ loja: FonteCodigo.optional() }),
  saida: z.object({
    lojas: z.array(
      z.object({
        loja: z.string(),
        nome: z.string(),
        ativa: z.boolean(),
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
