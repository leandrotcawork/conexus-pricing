import type { Codprod } from './marcas.ts'
import type { Produto } from './produto.ts'

export type ProdutoDoCatalogo = Omit<Produto, 'id'>

export type TipoDeMovimento = 'VENDA' | 'DEVOLUCAO' | 'COMPRA'

/** A soma dos itens liberados de um produto numa operação (TOP), nos últimos 12 meses. */
export type Movimento = {
  readonly codprod: Codprod
  readonly tipo: TipoDeMovimento
  /** A descrição mais recente da operação. */
  readonly operacao: string
  readonly centavos: number
}

type Classe = 'A' | 'B' | 'C'

export type ItemDoRecorte = { readonly produto: ProdutoDoCatalogo; readonly classe: Classe }

// o tipo de movimento não basta: nota de venda e de compra também registram transferência,
// consignação, serviço e despesa, que só a descrição da operação distingue
const FORA_DA_VENDA_E_DA_COMPRA = [
  'TRANSF',
  'CONSIGNA',
  'SERVI',
  'BONIFICA',
  'CONSUMO',
  'QUEBRA',
  'PERDA',
  'DENEGADA',
  'ICMS',
  'IMOBILIZADO',
  'ENERGIA',
  'TELECOM',
  'INVENTARIO',
  'SHOW ROOM',
  'AMOSTRA',
  'COMODATO',
  'OUTRAS ENTRADAS',
  'OUTRAS SAIDAS',
  'TESTE',
  'RESERVA',
  'LANCAMENTO',
  'LCT',
  'EMPRESTIMO',
]

const FORA: Readonly<Record<TipoDeMovimento, readonly string[]>> = {
  VENDA: FORA_DA_VENDA_E_DA_COMPRA,
  COMPRA: FORA_DA_VENDA_E_DA_COMPRA,
  DEVOLUCAO: ['CONSIGNA', 'TRANSF'],
}

function operacaoComercial({ tipo, operacao }: Movimento): boolean {
  const semAcento = operacao.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const comparavel = semAcento.toUpperCase()
  return !FORA[tipo].some((trecho) => comparavel.includes(trecho))
}

/** Venda líquida de cada produto e quem foi comprado, só com operação comercial. */
function somar(movimentos: readonly Movimento[]) {
  const vendido = new Map<Codprod, number>()
  const comprados = new Set<Codprod>()
  function acumular(codprod: Codprod, centavos: number) {
    vendido.set(codprod, (vendido.get(codprod) ?? 0) + centavos)
  }
  for (const movimento of movimentos.filter(operacaoComercial)) {
    switch (movimento.tipo) {
      case 'VENDA':
        acumular(movimento.codprod, movimento.centavos)
        break
      case 'DEVOLUCAO':
        acumular(movimento.codprod, -movimento.centavos)
        break
      case 'COMPRA':
        comprados.add(movimento.codprod)
        break
      default:
        movimento.tipo satisfies never
    }
  }
  return { vendido, comprados }
}

/** Pelo acumulado antes do produto: A abaixo de 80% do total, B abaixo de 95%, C no resto. */
function classeDe(antes: number, total: number): Classe {
  if (antes * 100 < total * 80) return 'A'
  return antes * 100 < total * 95 ? 'B' : 'C'
}

/**
 * O recorte R3: curva A e B, mais os C comprados nos últimos 12 meses. A curva ordena os produtos
 * do universo pela venda líquida; quem não tem venda líquida positiva fica fora dela e do recorte.
 */
export function recorteR3(
  universo: readonly ProdutoDoCatalogo[],
  movimentos: readonly Movimento[],
): readonly ItemDoRecorte[] {
  const { vendido, comprados } = somar(movimentos)
  const curva = universo
    .map((produto) => ({ produto, valor: vendido.get(produto.codprod) ?? 0 }))
    .filter(({ valor }) => valor > 0)
    // o código desempata, para o corte das classes não depender da ordem de leitura
    .sort((a, b) => b.valor - a.valor || Number(a.produto.codprod) - Number(b.produto.codprod))
  const total = curva.reduce((soma, { valor }) => soma + valor, 0)
  let antes = 0
  return curva.flatMap(({ produto, valor }) => {
    const classe = classeDe(antes, total)
    antes += valor
    const entra = classe !== 'C' || comprados.has(produto.codprod)
    return entra ? [{ produto, classe }] : []
  })
}
