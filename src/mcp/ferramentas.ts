import { z } from 'zod'
import { Codprod, Ean } from '../dominio/marcas.ts'
import {
  CodGrupoPedido,
  Instante,
  LOTE,
  NossoPreco,
  ProdutoRef,
  Reais,
  SituacaoAtual,
  SituacaoDaRodada,
} from './comuns.ts'

const Grupo = z.object({
  codigo: z.number().int(),
  caminho: z.string().describe('Os nomes da raiz até o grupo, separados por " > ".'),
})

export const buscarProdutos = {
  nome: 'buscar_produtos',
  titulo: 'Buscar produtos',
  descricao:
    'Produtos do catálogo por lista de códigos internos ou EANs (até 50 de uma vez), por texto da ' +
    'descrição, por marca ou por grupo (inclui os subgrupos; os códigos estão em grupos_produto). ' +
    'Os filtros valem juntos. Texto e marca ignoram maiúsculas e acentos, e todas as palavras do ' +
    'texto precisam aparecer. Pedidos de lista que o catálogo não tem voltam em naoEncontrados. ' +
    'Devolve 50 produtos por página: para a seguinte, repita a mesma busca com a continuacao.',
  entrada: z
    .object({
      codprods: z.array(Codprod).min(1).max(LOTE).optional(),
      eans: z.array(Ean).min(1).max(LOTE).optional(),
      texto: z.string().trim().min(2).optional(),
      marca: z.string().trim().min(1).optional(),
      grupo: CodGrupoPedido.optional(),
      continuacao: z.string().min(1).optional(),
    })
    .refine(
      (e) => (e.codprods ?? e.eans ?? e.texto ?? e.marca ?? e.grupo) !== undefined,
      'informe codprods, eans, texto, marca ou grupo',
    ),
  saida: z.object({
    produtos: z.array(
      z.object({
        codprod: z.string(),
        ean: z.string(),
        descricao: z.string(),
        marca: z.string().nullable(),
        grupo: Grupo.nullable(),
        nossoPreco: NossoPreco,
      }),
    ),
    naoEncontrados: z.array(z.string()),
    continuacao: z.string().nullable().describe('null na última página.'),
  }),
} as const

export const gruposProduto = {
  nome: 'grupos_produto',
  titulo: 'Grupos de produto',
  descricao:
    'As categorias do Sankhya em árvore, com quantos produtos do catálogo cada uma tem (contando ' +
    'os subgrupos) e quantos têm preço de concorrente. Só vêm grupos com produto no catálogo. Use ' +
    'o codigo em buscar_produtos e panorama_precos.',
  entrada: z.object({
    dentroDe: CodGrupoPedido.optional().describe('Só os subgrupos deste; omita para a raiz.'),
  }),
  saida: z.object({
    grupos: z.array(
      z.object({
        codigo: z.number().int(),
        nome: z.string(),
        pai: z.number().int().nullable().describe('null na raiz.'),
        produtos: z.number().int(),
        comPrecoDeConcorrente: z.number().int(),
      }),
    ),
  }),
} as const

const LojaAtual = z.object({
  loja: z.string(),
  situacao: SituacaoAtual,
  preco: Reais.nullable(),
  precoLista: Reais.nullable(),
  promocao: z
    .number()
    .nullable()
    .describe('1 − preco ÷ precoLista, quando a loja declara preço de lista.'),
  detalhes: z
    .object({
      vendedor: z.string().nullable(),
      url: z.string().nullable(),
      detalhe: z.string().nullable().describe('O motivo, quando a situação é ERRO.'),
      coletadoEm: Instante,
    })
    .optional()
    .describe('Só com detalhes: true.'),
})

export const precosAtuais = {
  nome: 'precos_atuais',
  titulo: 'Preços atuais',
  descricao:
    'Preço de cada loja para até 50 produtos, da última coleta concluída de cada loja. ' +
    'NAO_ENCONTRADO: a loja não vende; ERRO: a coleta falhou. A rodada de cada loja vem uma vez, ' +
    'em rodadas; lojasSemColeta não tem coleta concluída, e um produto que entrou no catálogo ' +
    'depois da coleta não traz a loja. Se uma coleta mais nova falhou, o preço continua o da ' +
    'anterior: veja saude_coleta. URL, vendedor e hora da coleta só com detalhes: true.',
  entrada: z.object({
    produtos: z.array(ProdutoRef).min(1).max(LOTE),
    detalhes: z.boolean().default(false),
  }),
  saida: z.object({
    rodadas: z.array(
      z.object({
        loja: z.string(),
        nome: z.string(),
        agendadaPara: Instante,
        situacao: SituacaoDaRodada.extract(['CONCLUIDA', 'SUSPEITA']),
      }),
    ),
    lojasSemColeta: z.array(z.string()),
    produtos: z.array(
      z.object({
        codprod: z.string(),
        descricao: z.string(),
        nossoPreco: NossoPreco,
        lojas: z.array(LojaAtual),
      }),
    ),
    naoEncontrados: z.array(z.string()),
  }),
} as const
