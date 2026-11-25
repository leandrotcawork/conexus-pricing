import type { Fonte, Plataforma } from './fonte.ts'
import { PLATAFORMAS } from './fonte.ts'
import type { Centavos, Codprod, Ean, FonteCodigo, FonteId, ProdutoId, RodadaId } from './marcas.ts'
import type { Observacao, SituacaoObservacao } from './observacao.ts'
import type { Produto } from './produto.ts'
import type { Aviso, Contagens, SituacaoRodada } from './rodada.ts'

function como<T>(valor: T): T {
  return valor
}

export function marcasNascemDeParse(): void {
  // @ts-expect-error um EAN cru não é Ean (code C23)
  como<Ean>('7891000100103')
  // @ts-expect-error um codprod cru não é Codprod
  como<Codprod>('1234')
  // @ts-expect-error um código de fonte cru não é FonteCodigo
  como<FonteCodigo>('loja')
  // @ts-expect-error um número cru não é ProdutoId
  como<ProdutoId>(1)
  // @ts-expect-error um número cru não é RodadaId
  como<RodadaId>(1)
  // @ts-expect-error um número cru não é FonteId
  como<FonteId>(1)
  // @ts-expect-error centavos nascem de parse ou de centavosDeReais
  como<Centavos>(1990)
}

export function observacaoNaoAdmiteEstadoSemSentido(preco: Centavos): void {
  // @ts-expect-error OK exige preço
  como<Observacao>({ situacao: 'OK', precoLista: null, vendedor: null, url: null, cadastros: 1 })
  // @ts-expect-error SEM_PRECO não carrega preço
  como<Observacao>({ situacao: 'SEM_PRECO', url: null, preco })
  // @ts-expect-error ERRO exige detalhe
  como<Observacao>({ situacao: 'ERRO' })
}

export function rotuloDeCadaSituacao(
  observacao: SituacaoObservacao,
  rodada: SituacaoRodada,
  aviso: Aviso,
): string {
  switch (observacao) {
    case 'OK':
    case 'SEM_ESTOQUE':
    case 'SEM_PRECO':
    case 'NAO_ENCONTRADO':
    case 'ERRO':
      break
    default:
      return observacao satisfies never
  }
  switch (rodada) {
    case 'RODANDO':
    case 'CONCLUIDA':
    case 'SUSPEITA':
    case 'FALHOU':
    case 'INTERROMPIDA':
      break
    default:
      return rodada satisfies never
  }
  switch (aviso.tipo) {
    case 'TOKEN_RESERVA_EM_USO':
    case 'LOTE_REFEITO_UM_A_UM':
    case 'QUEDA_DE_OK':
    case 'PRAZO_ESGOTADO':
    case 'CONFIG_INVALIDA':
      return aviso.tipo
    default:
      return aviso satisfies never
  }
}

export function contagensCobremTodaSituacao(): Contagens {
  // @ts-expect-error falta NAO_ENCONTRADO, SEM_PRECO e ERRO
  return { OK: 1, SEM_ESTOQUE: 0 }
}

export function produtoEFonteSaoMontadosComMarcas(
  produto: Produto,
  fonte: Fonte,
  plataforma: Plataforma,
): Plataforma {
  // @ts-expect-error uma plataforma fora da união fechada não existe
  como<Plataforma>('magento')
  como<readonly Plataforma[]>(PLATAFORMAS)
  como<Ean>(produto.ean)
  como<FonteCodigo>(fonte.codigo)
  return plataforma
}

export function listaDeSituacoesIgualAUniao(
  daUniao: Observacao['situacao'],
  daLista: SituacaoObservacao,
): readonly [SituacaoObservacao, Observacao['situacao']] {
  return [daUniao, daLista]
}
