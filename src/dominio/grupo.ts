import type { CodGrupo } from './marcas.ts'

/** Um grupo de produto do Sankhya (TGFGRU), a categoria do catálogo. */
export type Grupo = {
  readonly codigo: CodGrupo
  readonly nome: string
  /** null na raiz. */
  readonly pai: CodGrupo | null
  readonly grau: number
  readonly analitico: boolean
  readonly ativo: boolean
}

export function arvoreDeGrupos(grupos: readonly Grupo[]) {
  const porCodigo = new Map(grupos.map((grupo) => [grupo.codigo, grupo]))
  const filhos = new Map<CodGrupo, CodGrupo[]>()
  for (const { codigo, pai } of grupos) {
    if (pai !== null) filhos.set(pai, [...(filhos.get(pai) ?? []), codigo])
  }

  /** Do grupo até a raiz; o Set para num ciclo, que o banco não recusa. */
  function ateARaiz(codigo: CodGrupo): readonly Grupo[] {
    const vistos = new Set<Grupo>()
    let grupo = porCodigo.get(codigo)
    while (grupo !== undefined && !vistos.has(grupo)) {
      vistos.add(grupo)
      grupo = grupo.pai === null ? undefined : porCodigo.get(grupo.pai)
    }
    return [...vistos]
  }

  return {
    grupos,
    tem: (codigo: CodGrupo) => porCodigo.has(codigo),
    /** Os nomes da raiz até o grupo; null se o grupo não existe. */
    caminho(codigo: CodGrupo): string | null {
      const nomes = ateARaiz(codigo).map(({ nome }) => nome)
      return nomes.length === 0 ? null : nomes.reverse().join(' > ')
    },
    ateARaiz,
    /** O grupo e todos os de dentro dele; vazio se o grupo não existe. */
    comSubgrupos(codigo: CodGrupo): ReadonlySet<CodGrupo> {
      // o Set cresce enquanto é percorrido: cada filho novo também é visitado
      const achados = new Set(porCodigo.has(codigo) ? [codigo] : [])
      for (const achado of achados) {
        for (const filho of filhos.get(achado) ?? []) achados.add(filho)
      }
      return achados
    },
  }
}

export type ArvoreDeGrupos = ReturnType<typeof arvoreDeGrupos>

type Contagem = {
  readonly grupo: CodGrupo | null
  readonly produtos: number
  readonly comPreco: number
}

/**
 * Os grupos com produto no catálogo, cada um somado com os de dentro, em ordem de caminho. Com
 * `dentroDe`, só os subgrupos dele.
 */
export function resumirGrupos(
  arvore: ArvoreDeGrupos,
  pedido: { readonly contagens: readonly Contagem[]; readonly dentroDe?: CodGrupo | undefined },
) {
  const diretas = new Map(pedido.contagens.map((contagem) => [contagem.grupo, contagem]))
  const { dentroDe } = pedido
  const escopo = dentroDe === undefined ? undefined : arvore.comSubgrupos(dentroDe)
  return arvore.grupos
    .filter(({ codigo }) => escopo === undefined || (escopo.has(codigo) && codigo !== dentroDe))
    .map(({ codigo, nome, pai }) => {
      const somadas = [...arvore.comSubgrupos(codigo)].flatMap((c) => diretas.get(c) ?? [])
      const produtos = somadas.reduce((soma, c) => soma + c.produtos, 0)
      const comPrecoDeConcorrente = somadas.reduce((soma, c) => soma + c.comPreco, 0)
      return { codigo, nome, pai, produtos, comPrecoDeConcorrente }
    })
    .filter(({ produtos }) => produtos > 0)
    .map((grupo) => ({ grupo, caminho: arvore.caminho(grupo.codigo) ?? grupo.nome }))
    .toSorted((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'))
    .map(({ grupo }) => grupo)
}

/** O que a carga conta antes de gravar: o que a impede e o que só se informa. */
export function conferirGrupos(
  grupos: readonly Grupo[],
  dosProdutos: readonly (CodGrupo | null)[],
) {
  const porCodigo = new Map(grupos.map((grupo) => [grupo.codigo, grupo]))
  const informados = dosProdutos.filter((codigo) => codigo !== null)
  return {
    gruposDePaiInexistente: grupos.filter(({ pai }) => pai !== null && !porCodigo.has(pai)).length,
    produtosDeGrupoInexistente: informados.filter((codigo) => !porCodigo.has(codigo)).length,
    produtosSemGrupo: dosProdutos.length - informados.length,
    produtosEmGrupoSintetico: informados.filter(
      (codigo) => porCodigo.get(codigo)?.analitico === false,
    ).length,
  }
}
