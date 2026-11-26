import type { FonteCodigo } from './marcas.ts'

export const SEMANAS_PARA_MUDANCAS = 4
/** Quatro semanas recentes contra as quatro anteriores. */
export const SEMANAS_PARA_TENDENCIA = 8

const DIA_MS = 86_400_000

/** A semana, de segunda a domingo em UTC, contada a partir da que contém 1970-01-01. */
export function semanaDe(instante: Date): number {
  // 1970-01-01 foi uma quinta-feira: três dias depois da segunda
  return Math.floor((instante.getTime() / DIA_MS + 3) / 7)
}

type RodadaDeLoja = { readonly loja: FonteCodigo; readonly agendadaPara: Date }

/**
 * O histórico semanal das rodadas que deram preço. De cada loja vale uma rodada por semana, a mais
 * nova: rodar a mesma loja outra vez na semana não cria histórico.
 */
export function serieSemanal<R extends RodadaDeLoja>(rodadas: readonly R[]) {
  const maisNovasPrimeiro = rodadas.toSorted(
    (a, b) => b.agendadaPara.getTime() - a.agendadaPara.getTime(),
  )
  const semanas = new Map<number, Map<FonteCodigo, R>>()
  const daLoja = new Map<FonteCodigo, R[]>()
  for (const rodada of maisNovasPrimeiro) {
    const semana = semanaDe(rodada.agendadaPara)
    const daSemana = semanas.get(semana) ?? new Map<FonteCodigo, R>()
    semanas.set(semana, daSemana)
    if (daSemana.has(rodada.loja)) continue
    daSemana.set(rodada.loja, rodada)
    daLoja.set(rodada.loja, [...(daLoja.get(rodada.loja) ?? []), rodada])
  }
  const lojas = [...daLoja.values()]
  return {
    semanasComColeta: semanas.size,
    /** A última rodada de cada loja. */
    atuais: lojas.flatMap(([atual]) => (atual ? [atual] : [])),
    /** A rodada anterior de cada loja que a tem, de outra semana. */
    anteriores: lojas.flatMap(([, anterior]) => (anterior ? [anterior] : [])),
    /** As semanas mais novas que a tendência olha, a mais antiga primeiro. */
    janela: [...semanas]
      .slice(0, SEMANAS_PARA_TENDENCIA)
      .reverse()
      .map(([semana, daSemana]) => ({ semana, rodadas: [...daSemana.values()] })),
  }
}
