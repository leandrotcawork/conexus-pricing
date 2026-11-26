import type { Aviso } from '../dominio/rodada.ts'

export function textoDoAviso(aviso: Aviso): string {
  switch (aviso.tipo) {
    case 'TOKEN_RESERVA_EM_USO':
      return 'a coleta usou o token reserva da loja, porque não achou o token na home'
    case 'PREPARO_FALHOU':
      return `o preparo da coleta falhou: ${aviso.motivo}`
    case 'LOTE_REFEITO_UM_A_UM':
      return `um lote de ${aviso.eans} EANs foi refeito um a um: ${aviso.motivo}`
    case 'QUEDA_DE_OK':
      return `os produtos com preço caíram de ${aviso.anterior} para ${aviso.atual}`
    case 'PRAZO_ESGOTADO':
      return `o prazo acabou com ${aviso.faltaram} produtos sem perguntar`
    case 'CONFIG_INVALIDA':
      return `a configuração da loja é inválida: ${aviso.motivo}`
    case 'NENHUM_OK':
      return `nenhum produto voltou com preço, e ${aviso.erros} deram erro`
    default:
      return aviso satisfies never
  }
}
