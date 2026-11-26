import { Centavos } from './marcas.ts'
import type { SituacaoObservacao } from './observacao.ts'

/** Só o preço à venda entra em estatística, o de hoje e o do período. */
export const SITUACAO_DAS_ESTATISTICAS: SituacaoObservacao = 'OK'

export type PrecoColetado = { readonly preco: Centavos; readonly coletadoEm: Date }

function media(precos: readonly Centavos[]): Centavos {
  const soma = precos.reduce<number>((total, preco) => total + preco, 0)
  return Centavos.parse(Math.round(soma / precos.length))
}

/** null sem preço nenhum: não existe resumo de nada. */
export function resumir(precos: readonly Centavos[]) {
  const ordenados = precos.toSorted((a, b) => a - b)
  const [minimo] = ordenados
  const maximo = ordenados.at(-1)
  if (minimo === undefined || maximo === undefined) return null
  // um item no meio quando a quantidade é ímpar, os dois do meio quando é par
  const meio = ordenados.slice(
    Math.floor((ordenados.length - 1) / 2),
    Math.floor(ordenados.length / 2) + 1,
  )
  return { minimo, maximo, media: media(ordenados), mediana: media(meio) }
}

/** Quanto o preço está acima (positivo) ou abaixo da referência, em % com duas casas. */
export function diferencaPct(preco: Centavos, referencia: Centavos): number {
  return Math.round(((preco - referencia) * 10_000) / referencia) / 100
}

/**
 * A primeira coleta da sequência que chega ao preço de agora sem outro preço no meio.
 * `maisNovosPrimeiro` já vem só com o que entra em estatística; null se ele não tem o preço.
 */
export function mesmoPrecoDesde(
  maisNovosPrimeiro: readonly PrecoColetado[],
  atual: Centavos,
): Date | null {
  const mudou = maisNovosPrimeiro.findIndex(({ preco }) => preco !== atual)
  const sequencia = mudou === -1 ? maisNovosPrimeiro : maisNovosPrimeiro.slice(0, mudou)
  return sequencia.at(-1)?.coletadoEm ?? null
}
