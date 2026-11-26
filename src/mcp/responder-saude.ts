import type { Leituras } from '../banco/leituras.ts'
import { textoDoAviso } from './avisos.ts'
import type { saudeColeta } from './ferramentas-de-mercado.ts'
import type { Entrada, Resposta, Saida } from './respostas.ts'
import { recusada, respondida } from './respostas.ts'

const HORA_MS = 3_600_000

type UltimaRodada = Awaited<ReturnType<Leituras['ultimasRodadas']>>[number]['rodada']

function resumoDaRodada(rodada: NonNullable<UltimaRodada>) {
  const { situacao, agendadaPara, iniciadaEm, concluidaEm, contagens, avisos } = rodada
  const idadeMs = Date.now() - (concluidaEm ?? iniciadaEm).getTime()
  return {
    agendadaPara: agendadaPara.toISOString(),
    situacao,
    iniciadaEm: iniciadaEm.toISOString(),
    concluidaEm: concluidaEm?.toISOString() ?? null,
    contagens,
    avisos: avisos.map(textoDoAviso),
    idadeHoras: Math.round((idadeMs / HORA_MS) * 10) / 10,
  }
}

export async function responderSaude(
  leituras: Leituras,
  { loja }: Entrada<typeof saudeColeta>,
): Promise<Resposta<Saida<typeof saudeColeta>>> {
  const lojas = await leituras.ultimasRodadas(loja)
  if (loja !== undefined && lojas.length === 0) return recusada('loja não encontrada')
  return respondida({
    lojas: lojas.map(({ rodada, ...daLoja }) => ({
      ...daLoja,
      ultimaRodada: rodada && resumoDaRodada(rodada),
    })),
  })
}
