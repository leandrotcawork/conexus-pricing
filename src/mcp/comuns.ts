import { z } from 'zod'
import { Codprod, Ean } from '../dominio/marcas.ts'
import { SITUACOES_OBSERVACAO } from '../dominio/observacao.ts'
import { SITUACOES_RODADA } from '../dominio/rodada.ts'

/** Quantos produtos cabem num pedido, e numa página. */
export const LOTE = 50

export const ProdutoRef = z
  .union([z.strictObject({ codprod: Codprod }), z.strictObject({ ean: Ean })])
  .describe('O produto, pelo código interno (codprod) ou pelo EAN: um dos dois.')
export const CodGrupoPedido = z.number().int().nonnegative().brand<'CodGrupo'>()
export const Reais = z.number().positive() // centavos / 100 na borda; nunca zero
export const Instante = z.iso.datetime() // UTC (code C40)
export const NossoPreco = Reais.nullable().describe(
  'O nosso preço de tabela, em reais; null se não há.',
)

export const SituacaoAtual = z
  .enum(SITUACOES_OBSERVACAO)
  .describe(
    'OK: à venda por este preço. SEM_ESTOQUE: indisponível, com o preço que a loja publica. ' +
      'SEM_PRECO: a loja publica o produto sem preço. NAO_ENCONTRADO: a loja não vende o ' +
      'produto. ERRO: a coleta falhou, e não se sabe o preço nem se a loja vende.',
  )

export const SituacaoDaRodada = z
  .enum(SITUACOES_RODADA)
  .describe(
    'CONCLUIDA: terminou. SUSPEITA: terminou com menos da metade dos preços da anterior. ' +
      'FALHOU: não deu preço que valha; os avisos dizem por quê. INTERROMPIDA: o prazo acabou ' +
      'antes de perguntar tudo. RODANDO: em andamento.',
  )
