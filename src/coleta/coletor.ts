import { abrirBanco } from '../banco/conexao.ts'
import { saudeDe } from '../banco/leituras.ts'
import { FonteCodigo } from '../dominio/marcas.ts'
import type { ResultadoRodada } from './executar.ts'
import { executarRodada } from './executar.ts'
import type { ClienteHttp } from './http.ts'
import { clienteCrawlee, TETO_BYTES_POR_RESPOSTA } from './http.ts'

const VERSAO = 'e3'

function clienteDaRodada(): ClienteHttp {
  return clienteCrawlee({
    porMinuto: 60,
    tentativas: 1,
    prazoPedidoMs: 25_000, // base.py:21
    esperaMaximaMs: 60_000, // base.py:184-188
    tetoBytes: TETO_BYTES_POR_RESPOSTA,
    // o Neon espera a resposta por 15 minutos: sobram 2 para gravar e fechar a rodada
    prazoFinal: new Date(Date.now() + 13 * 60_000),
  })
}

export function criarColetor(urlDoBanco: string, criarHttp: () => ClienteHttp = clienteDaRodada) {
  const banco = abrirBanco(urlDoBanco)
  return {
    /** A coleta só está de pé se entrar com a role que escreve. */
    saude: saudeDe(banco, 'coletor'),
    async rodar(pedido: {
      readonly codigo: string
      readonly agendadaPara: Date
    }): Promise<ResultadoRodada> {
      const fonte = FonteCodigo.safeParse(pedido.codigo)
      if (!fonte.success) return { tipo: 'FONTE_DESCONHECIDA' }
      return await executarRodada(
        { banco, http: criarHttp() },
        { fonte: fonte.data, agendadaPara: pedido.agendadaPara, versao: VERSAO },
      )
    },
  }
}
