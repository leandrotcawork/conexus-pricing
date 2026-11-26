/**
 * A carga única do catálogo: lê o Sankhya sem gravar nada nele, aplica o recorte R3 e grava
 * `precos.grupo` e `precos.produto`. A saída é só de contagens, porque o resto é dado da empresa.
 */
import oracledb from 'oracledb'
import { z } from 'zod'
import { gravarCatalogo } from '../src/banco/catalogo.ts'
import { abrirBanco, fecharBanco } from '../src/banco/conexao.ts'
import { configDaCarga } from '../src/config.ts'
import type { Grupo } from '../src/dominio/grupo.ts'
import { conferirGrupos, enraizarInativosSemPai } from '../src/dominio/grupo.ts'
import { CodGrupo, Codprod, centavosDeReais, Ean } from '../src/dominio/marcas.ts'
import type { ItemDoRecorte } from '../src/dominio/recorte.ts'
import { recorteR3 } from '../src/dominio/recorte.ts'

/** "Nosso preço" é a tabela 0, a cheia (decisão do fundador, a mesma do MetalPrice). */
const CODTAB_NOSSO_PRECO = 0

// O EAN está em REFERENCIA e a referência do fabricante em REFFORN: os nomes enganam
// (catalogo.py:3-6). O preço é versionado por NUTAB e cada versão só traz o que mudou: vale a
// mais recente já vigente que contém o produto (catalogo.py:71-82).
const PRODUTOS = `
SELECT P.CODPROD,
       TRIM(P.REFERENCIA) AS EAN,
       TRIM(P.REFFORN) AS REFERENCIA_FABRICANTE,
       P.DESCRPROD AS DESCRICAO,
       TRIM(P.MARCA) AS MARCA,
       P.CODGRUPOPROD AS GRUPO,
       N.VLRVENDA AS NOSSO_PRECO
FROM TGFPRO P
LEFT JOIN (
  SELECT CODPROD, VLRVENDA FROM (
    SELECT E.CODPROD, E.VLRVENDA,
           ROW_NUMBER() OVER (
             PARTITION BY E.CODPROD ORDER BY T.DTVIGOR DESC, T.NUTAB DESC) AS RN
    FROM TGFEXC E
    JOIN TGFTAB T ON T.NUTAB = E.NUTAB
    WHERE T.CODTAB = :codtab AND T.DTVIGOR <= SYSDATE
  ) WHERE RN = 1
) N ON N.CODPROD = P.CODPROD
WHERE P.ATIVO = 'S' AND REGEXP_LIKE(TRIM(P.REFERENCIA), '^[0-9]{12,14}$')`

// a árvore inteira, e não só os grupos do recorte: o caminho de um produto precisa dos ancestrais
const GRUPOS = `
SELECT CODGRUPOPROD AS CODIGO,
       TRIM(DESCRGRUPOPROD) AS NOME,
       CODGRUPAI AS PAI,
       GRAU,
       ANALITICO,
       ATIVO
FROM TGFGRU`

// V venda, D devolução de venda, C compra, O pedido de compra, só os liberados (L). O pedido de
// venda (P) fica fora: vira nota V ao faturar, e a maior parte dele é orçamento. A operação sem
// descrição chega nula (LEFT JOIN) e o parse a recusa, em vez de o movimento sumir calado.
const MOVIMENTOS = `
WITH OPERACAO AS (
  SELECT CODTIPOPER, DESCROPER FROM (
    SELECT CODTIPOPER, DESCROPER,
           ROW_NUMBER() OVER (PARTITION BY CODTIPOPER ORDER BY DHALTER DESC) AS RN
    FROM TGFTOP
  ) WHERE RN = 1
)
SELECT I.CODPROD,
       C.TIPMOV,
       O.DESCROPER AS OPERACAO,
       SUM(NVL(I.VLRTOT, 0) - NVL(I.VLRDESC, 0)) AS VALOR
FROM TGFITE I
JOIN TGFCAB C ON C.NUNOTA = I.NUNOTA
LEFT JOIN OPERACAO O ON O.CODTIPOPER = C.CODTIPOPER
WHERE C.TIPMOV IN ('V', 'D', 'C', 'O') AND C.STATUSNOTA = 'L'
  AND C.DTNEG >= ADD_MONTHS(TRUNC(SYSDATE), -12)
GROUP BY I.CODPROD, C.TIPMOV, C.CODTIPOPER, O.DESCROPER`

const CodigoDoProduto = z.number().int().transform(String).pipe(Codprod)

const LinhaDeProduto = z
  .object({
    CODPROD: CodigoDoProduto,
    EAN: Ean,
    REFERENCIA_FABRICANTE: z.string().nullable(),
    DESCRICAO: z.string(),
    MARCA: z.string().nullable(),
    GRUPO: z.number().int().pipe(CodGrupo).nullable(),
    NOSSO_PRECO: z.number().nullable(),
  })
  .transform((linha) => ({
    codprod: linha.CODPROD,
    ean: linha.EAN,
    referenciaFabricante: linha.REFERENCIA_FABRICANTE,
    descricao: linha.DESCRICAO,
    marca: linha.MARCA,
    grupo: linha.GRUPO,
    nossoPreco: linha.NOSSO_PRECO === null ? null : centavosDeReais(linha.NOSSO_PRECO),
  }))

const SimOuNao = z.enum(['S', 'N']).transform((valor) => valor === 'S')

/** No TGFGRU, a raiz pode vir sem pai ou com este marcador de "sem pai" do Sankhya. */
const SEM_PAI = -999_999_999

const LinhaDeGrupo = z
  .object({
    CODIGO: z.number().int().pipe(CodGrupo),
    NOME: z.string(),
    PAI: z.number().int().pipe(CodGrupo).nullable(),
    GRAU: z.number().int(),
    ANALITICO: SimOuNao,
    ATIVO: SimOuNao,
  })
  .transform(
    (linha): Grupo => ({
      codigo: linha.CODIGO,
      nome: linha.NOME,
      pai: linha.PAI === SEM_PAI ? null : linha.PAI,
      grau: linha.GRAU,
      analitico: linha.ANALITICO,
      ativo: linha.ATIVO,
    }),
  )

const TIPOS = { V: 'VENDA', D: 'DEVOLUCAO', C: 'COMPRA', O: 'COMPRA' } as const

const LinhaDeMovimento = z
  .object({
    CODPROD: CodigoDoProduto,
    TIPMOV: z.enum(['V', 'D', 'C', 'O']),
    OPERACAO: z.string({ error: 'operação sem descrição no TGFTOP' }),
    VALOR: z.number(),
  })
  .transform((linha) => ({
    codprod: linha.CODPROD,
    tipo: TIPOS[linha.TIPMOV],
    operacao: linha.OPERACAO,
    centavos: Math.round(linha.VALOR * 100),
  }))

/** A recusa leva o caminho e o problema da primeira linha ruim, nunca o valor lido. */
async function consultar<T>(
  conexao: oracledb.Connection,
  consulta: { readonly sql: string; readonly binds: Record<string, number> },
  linha: z.ZodType<T>,
): Promise<T[]> {
  const opcoes = { outFormat: oracledb.OUT_FORMAT_OBJECT }
  const { rows } = await conexao.execute(consulta.sql, consulta.binds, opcoes)
  const lidas = z.array(linha).safeParse(rows)
  if (lidas.success) return lidas.data
  const [primeiro, ...outros] = lidas.error.issues
  throw new Error(
    `o Sankhya devolveu ${outros.length + 1} valores fora do formato; o primeiro, na linha e coluna ${primeiro?.path.join('.')}: ${primeiro?.message}`,
  )
}

async function lerSankhya({ oracle, esquema }: ReturnType<typeof configDaCarga>) {
  // modo thick: o servidor usa um verificador de senha que o modo thin não aceita
  oracledb.initOracleClient()
  const conexao = await oracledb.getConnection(oracle)
  try {
    await conexao.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${esquema}`)
    // as três consultas veem o mesmo instante, e a transação não aceita escrita
    await conexao.execute('SET TRANSACTION READ ONLY')
    const binds = { codtab: CODTAB_NOSSO_PRECO }
    const produtos = await consultar(conexao, { sql: PRODUTOS, binds }, LinhaDeProduto)
    const movimentos = await consultar(conexao, { sql: MOVIMENTOS, binds: {} }, LinhaDeMovimento)
    const grupos = await consultar(conexao, { sql: GRUPOS, binds: {} }, LinhaDeGrupo)
    return { produtos, movimentos, grupos }
  } finally {
    await conexao.rollback()
    await conexao.close()
  }
}

/**
 * Um pai ou um grupo de produto que não existe na árvore recusa a carga inteira, com a contagem: a
 * chave estrangeira recusaria sem dizer quantos. Os inativos sem pai já chegam como raiz.
 */
function conferir(grupos: readonly Grupo[], itens: readonly ItemDoRecorte[]) {
  const contagens = conferirGrupos(
    grupos,
    itens.map((item) => item.produto.grupo),
  )
  const { gruposDePaiInexistente, produtosDeGrupoInexistente } = contagens
  if (gruposDePaiInexistente > 0 || produtosDeGrupoInexistente > 0) {
    throw new Error(
      `nada foi gravado: grupos com um pai que não existe no TGFGRU: ${gruposDePaiInexistente}; produtos do recorte num grupo que não existe: ${produtosDeGrupoInexistente}`,
    )
  }
  return contagens
}

type Gravado = ReturnType<typeof conferir> & {
  readonly grupos: number
  readonly inativosEnraizados: number
  readonly linhasNoBanco: number
}

function resumo(itens: readonly ItemDoRecorte[], gravado: Gravado): string {
  const semPreco = itens.filter((item) => item.produto.nossoPreco === null).length
  let acumulado = 0
  const classes = (['A', 'B', 'C'] as const).map((classe) => {
    const quantos = itens.filter((item) => item.classe === classe).length
    acumulado += quantos
    return `classe ${classe}: ${quantos} (acumulado ${acumulado})`
  })
  return [
    `produtos do recorte R3: ${itens.length}`,
    `sem nosso preço: ${semPreco}`,
    ...classes,
    `grupos de produto: ${gravado.grupos}`,
    `grupos inativos de pai inexistente gravados como raiz: ${gravado.inativosEnraizados}`,
    `produtos sem grupo: ${gravado.produtosSemGrupo}`,
    `produtos em grupo sintético: ${gravado.produtosEmGrupoSintetico}`,
    `linhas em precos.produto: ${gravado.linhasNoBanco}`,
  ].join('\n')
}

async function carregar(): Promise<void> {
  const config = configDaCarga()
  const { produtos, movimentos, grupos: lidos } = await lerSankhya(config)
  const itens = recorteR3(produtos, movimentos)
  if (itens.length === 0) {
    throw new Error('o recorte veio vazio e nada foi gravado; confira SANKHYA_ORACLE_SCHEMA')
  }
  const { grupos, inativosEnraizados } = enraizarInativosSemPai(lidos)
  const contagens = conferir(grupos, itens)
  const banco = abrirBanco(config.urlDoDono)
  try {
    const linhasNoBanco = await gravarCatalogo(banco, { grupos, itens })
    const gravado = { ...contagens, grupos: grupos.length, inativosEnraizados, linhasNoBanco }
    console.log(resumo(itens, gravado))
  } finally {
    await fecharBanco(banco)
  }
}

await carregar()
