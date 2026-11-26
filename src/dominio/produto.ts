import type { Centavos, CodGrupo, Codprod, Ean, ProdutoId } from './marcas.ts'

export type Produto = {
  readonly id: ProdutoId
  readonly codprod: Codprod
  readonly ean: Ean
  readonly referenciaFabricante: string | null
  readonly descricao: string
  readonly marca: string | null
  /** null: o Sankhya não diz o grupo, ou o produto é de uma carga anterior à categoria. */
  readonly grupo: CodGrupo | null
  readonly nossoPreco: Centavos | null
}
