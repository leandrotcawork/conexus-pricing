import { abrirBanco } from '../banco/conexao.ts'
import { saudeDe } from '../banco/leituras.ts'
import { FonteCodigo } from '../dominio/marcas.ts'
import type { ResultadoRodada } from './executar.ts'
import { executarRodada } from './executar.ts'
import type { ClienteHttp } from './http.ts'
import { clienteCrawlee } from './http.ts'

/** Fica em cada rodada, para saber que coleta a fez. */
const VERSAO = 'e3'

/** O cliente de uma rodada nova: o prazo final dela começa a contar aqui. */
function clienteDaRodada(): ClienteHttp {
  return clienteCrawlee({
    porMinuto: 60,
    tentativas: 1,
    prazoPedidoMs: 25_000, // base.py:21
    esperaMaximaMs: 60_000, // base.py:184-188
    // a maior resposta medida tem 1,6 MB (a home da ABC); um lote de 50 da VTEX, com os 45 KB do
    // maior produto visto, chegaria a 2,3 MB
    tetoBytes: 10 * 1024 * 1024,
    // a função tem 15 minutos: sobram 2 para gravar e fechar a rodada
    prazoFinal: new Date(Date.now() + 13 * 60_000),
  })
}

/** A coleta ligada ao banco: um pool por função, um cliente HTTP por rodada. */
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
