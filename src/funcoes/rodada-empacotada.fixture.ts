import { clienteNaLojaDeTeste } from '../coleta/loja-de-teste.ts'
import { configDaColeta } from '../config.ts'
import { criarFuncaoColeta } from './coleta.ts'

let funcao: ReturnType<typeof criarFuncaoColeta> | undefined

/** A função da coleta com as lojas no endereço que o teste de empacotamento passa na consulta. */
export default {
  fetch(pedido: Request): Promise<Response> {
    const loja = new URL(pedido.url).searchParams.get('loja') ?? ''
    funcao ??= criarFuncaoColeta(configDaColeta(), () => clienteNaLojaDeTeste(loja))
    return funcao.fetch(pedido)
  },
}
