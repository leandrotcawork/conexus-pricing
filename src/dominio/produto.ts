import type { Centavos, Codprod, Ean, ProdutoId } from './marcas.ts'

export type Produto = {
  readonly id: ProdutoId
  readonly codprod: Codprod
  readonly ean: Ean
  readonly referenciaFabricante: string | null
  readonly descricao: string
  readonly marca: string | null
  readonly nossoPreco: Centavos | null
}
