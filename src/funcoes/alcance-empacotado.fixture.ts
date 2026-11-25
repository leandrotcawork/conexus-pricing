import { configDaColeta } from '../config.ts'
import { criarFuncaoColeta } from './coleta.ts'

/** A função da coleta com as lojas no endereço que o teste de empacotamento passa na consulta. */
export default {
  fetch(pedido: Request): Promise<Response> {
    const loja = new URL(pedido.url).searchParams.get('loja') ?? ''
    const alvos = {
      telhanorte: loja,
      condec: loja,
      abc: { api: `${loja}/graphql`, loja },
    }
    return criarFuncaoColeta(configDaColeta(), alvos).fetch(pedido)
  },
}
