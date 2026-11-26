/**
 * Um Sankhya de mentira para o Oracle local: as tabelas que a carga lê, só com as colunas lidas,
 * e dados inventados em que cada linha prova uma regra. O gabarito está no teste.
 */
type Valor = string | number | null
type Executar = (sql: string, binds: Valor[]) => Promise<unknown>

const TABELAS = {
  TGFPRO: `CODPROD NUMBER PRIMARY KEY, REFERENCIA VARCHAR2(30), REFFORN VARCHAR2(30),
    DESCRPROD VARCHAR2(60), MARCA VARCHAR2(30), ATIVO CHAR(1), CODGRUPOPROD NUMBER`,
  TGFGRU: `CODGRUPOPROD NUMBER PRIMARY KEY, DESCRGRUPOPROD VARCHAR2(60), CODGRUPAI NUMBER,
    GRAU NUMBER, ANALITICO CHAR(1), ATIVO CHAR(1)`,
  TGFTOP: `CODTIPOPER NUMBER, DHALTER DATE, DESCROPER VARCHAR2(60),
    PRIMARY KEY (CODTIPOPER, DHALTER)`,
  TGFCAB: `NUNOTA NUMBER PRIMARY KEY, TIPMOV CHAR(1), STATUSNOTA CHAR(1), DTNEG DATE,
    CODTIPOPER NUMBER`,
  TGFITE: 'NUNOTA NUMBER PRIMARY KEY, CODPROD NUMBER, VLRTOT NUMBER, VLRDESC NUMBER',
  TGFTAB: 'NUTAB NUMBER PRIMARY KEY, CODTAB NUMBER, DTVIGOR DATE',
  TGFEXC: 'NUTAB NUMBER, CODPROD NUMBER, VLRVENDA NUMBER, PRIMARY KEY (NUTAB, CODPROD)',
}

export const NOMES_DAS_TABELAS = Object.keys(TABELAS)

type Produto = readonly [
  codprod: number,
  referencia: string,
  refforn: string | null,
  marca: string | null,
  ativo: 'S' | 'N',
  grupo?: number,
]

// a REFERENCIA é onde o Sankhya guarda o EAN
// o 103 não tem grupo; o 104 e o 111 estão em grupo sintético
const PRODUTOS: readonly Produto[] = [
  [101, '2000000000101', 'FAB-101', 'Marca A', 'S', 10],
  [102, '2000000000102', null, '  Marca B  ', 'S', 21],
  [103, '  200000000103  ', 'FAB-103', null, 'S'],
  [104, '20000000000104', 'FAB-104', 'Marca A', 'S', 20],
  [105, '2000000000105', 'FAB-105', 'Marca A', 'S', 10],
  [106, '2000000000106', 'FAB-106', 'Marca A', 'S', 21],
  // um grupo que não existe, num produto fora do recorte, não recusa a carga
  [107, '2000000000107', null, null, 'S', 999],
  [108, '2000000000108', null, null, 'S'],
  [109, '2000000000109', null, null, 'S'],
  [110, '2000000000110', null, null, 'S', 10],
  [111, '2000000000111', null, null, 'S', 1],
  [116, '2000000000116', null, null, 'S'],
  // fora do universo: inativo, EAN curto, EAN longo e sem EAN
  [112, '2000000000112', null, null, 'N', 999],
  [113, '20000000113', null, null, 'S'],
  [114, '200000000000114', null, null, 'S'],
  [115, 'SEM EAN', null, null, 'S'],
]

// código, nome, pai, grau, analítico, ativo; o filho vem antes do pai, há uma raiz com o
// marcador de "sem pai" do Sankhya e outra com o pai nulo, e o 30 é inativo e aponta para um pai
// que não existe
const GRUPOS: readonly Valor[][] = [
  [21, 'Folha dois', 20, 3, 'S', 'N'],
  [10, '  Folha um  ', 1, 2, 'S', 'S'],
  [20, 'Subgrupo', 1, 2, 'N', 'S'],
  [1, 'Raiz inventada', -999_999_999, 1, 'N', 'S'],
  [2, 'Outra raiz inventada', null, 1, 'S', 'S'],
  [30, 'Inativos inventado', 900, 2, 'S', 'N'],
]

// código, meses atrás em que a descrição passou a valer, descrição
const OPERACOES: readonly Valor[][] = [
  [1, 36, 'VENDA'],
  [2, 36, 'TRANSFERÊNCIA ENTRE FILIAIS'],
  [3, 36, 'DEVOLUÇÃO DE VENDA'],
  [4, 36, 'DEVOLUÇÃO DE CONSIGNAÇÃO'],
  [5, 36, 'ORÇAMENTO'],
  [6, 36, 'DEVOLUÇÃO DE VENDA COM SERVIÇO'],
  [7, 36, 'NFS-E DE SERVIÇO'],
  [8, 36, 'COMPRA PARA REVENDA'],
  [9, 36, 'PEDIDO DE COMPRA'],
  [10, 36, 'ENTRADA POR TRANSFERÊNCIA'],
  [11, 36, 'BONIFICAÇÃO'],
  [11, 18, 'VENDA BALCÃO'],
  [12, 36, 'VENDA ANTIGA'],
  [12, 18, 'REMESSA EM BONIFICAÇÃO'],
]

type Data = readonly [meses: number, dias: number]
const RECENTE: Data = [-1, 0]
const NO_LIMITE: Data = [-12, 0]
const VELHO: Data = [-12, -1]

type Nota = readonly [
  codprod: number,
  tipmov: 'V' | 'D' | 'C' | 'O' | 'P',
  operacao: number,
  valor: number,
  outros?: { readonly desconto?: number; readonly status?: 'A' | 'P'; readonly data?: Data },
]

const NOTAS: readonly Nota[] = [
  // 101: 5.200,10 menos 100,10 de desconto menos 100 devolvidos = 5.000
  [101, 'V', 1, 5200.1, { desconto: 100.1 }],
  [101, 'D', 3, 100],
  [101, 'V', 2, 9999],
  [101, 'D', 4, 4000],
  // 102: 3.000; nota não liberada, orçamento e pedido de venda não contam
  [102, 'V', 1, 3000],
  [102, 'V', 1, 50000, { status: 'A' }],
  [102, 'P', 5, 100000],
  [102, 'P', 1, 70000],
  // 103: 1.000, na borda dos 12 meses; a venda de um dia antes não conta
  [103, 'V', 1, 1000, { data: NO_LIMITE }],
  [103, 'V', 1, 7000, { data: VELHO }],
  // 104: 600 menos 100 = 500; vale a descrição mais recente da operação 11 e da 12
  [104, 'V', 11, 600],
  [104, 'D', 6, 100],
  [104, 'V', 7, 3000],
  [104, 'V', 12, 8000],
  // classe C: comprado por nota (105) e por pedido de compra (106) entra
  [105, 'V', 1, 200],
  [105, 'C', 8, 10],
  [106, 'V', 1, 150],
  [106, 'O', 9, 10, { data: NO_LIMITE }],
  // classe C sem compra que conte: velha, por transferência, não liberada ou nenhuma
  [107, 'V', 1, 80],
  [107, 'C', 8, 10, { data: VELHO }],
  [108, 'V', 1, 40],
  [108, 'C', 10, 10],
  [108, 'C', 8, 10, { status: 'P' }],
  [109, 'V', 1, 30],
  [109, 'D', 3, 30, { status: 'P' }],
  [109, 'P', 9, 10],
  // sem venda líquida positiva: C se comprado (110 devolveu mais do que vendeu, 111 só comprou)
  [110, 'V', 1, 500],
  [110, 'D', 3, 600],
  [110, 'C', 8, 10],
  [111, 'C', 8, 10],
  // sem venda e sem compra comercial: fora
  [116, 'C', 10, 10],
  // fora do universo: se entrassem, mudariam todas as classes
  [112, 'V', 1, 100000],
  [113, 'V', 1, 100000],
  [114, 'V', 1, 100000],
  [115, 'V', 1, 100000],
]

// nutab, codtab, meses e dias até a vigência
const VERSOES_DE_PRECO: readonly Valor[][] = [
  [1, 0, -24, 0],
  [2, 0, -1, 0],
  [3, 0, 1, 0],
  [4, 200, 0, -1],
  [5, 0, -1, 0],
]

// nutab, codprod, preço
const PRECOS: readonly Valor[][] = [
  // 101: vale a vigente mais recente; a futura e a tabela 200 não contam
  [1, 101, 10],
  [2, 101, 12.34],
  [3, 101, 99],
  [4, 101, 1],
  // 102: a versão mais recente não o contém
  [1, 102, 20],
  // 103: a vigente mais recente é zero, e isso não é preço
  [1, 103, 30],
  [2, 103, 0],
  // 105: duas versões no mesmo dia, vale a de NUTAB maior
  [2, 105, 1.11],
  [5, 105, 5.55],
  // 106: só na tabela 200 e numa versão futura
  [3, 106, 7],
  [4, 106, 6],
]

async function semearNotas(executar: Executar) {
  for (const [indice, [codprod, tipmov, operacao, valor, outros]] of NOTAS.entries()) {
    const { desconto = 0, status = 'L', data = RECENTE } = outros ?? {}
    const nota = indice + 1
    await executar(
      'INSERT INTO TGFCAB VALUES (:1, :2, :3, ADD_MONTHS(TRUNC(SYSDATE), :4) + :5, :6)',
      [nota, tipmov, status, ...data, operacao],
    )
    await executar('INSERT INTO TGFITE VALUES (:1, :2, :3, :4)', [nota, codprod, valor, desconto])
  }
}

/** Cria as tabelas no esquema da conexão e as enche. Quem chama confirma a transação. */
export async function semearSankhya(executar: Executar): Promise<void> {
  for (const [nome, colunas] of Object.entries(TABELAS)) {
    await executar(`CREATE TABLE ${nome} (${colunas})`, [])
  }
  for (const [codprod, referencia, refforn, marca, ativo, grupo = null] of PRODUTOS) {
    const descricao = `Item inventado ${codprod}`
    await executar('INSERT INTO TGFPRO VALUES (:1, :2, :3, :4, :5, :6, :7)', [
      codprod,
      referencia,
      refforn,
      descricao,
      marca,
      ativo,
      grupo,
    ])
  }
  for (const grupo of GRUPOS) {
    await executar('INSERT INTO TGFGRU VALUES (:1, :2, :3, :4, :5, :6)', [...grupo])
  }
  for (const operacao of OPERACOES) {
    await executar('INSERT INTO TGFTOP VALUES (:1, ADD_MONTHS(TRUNC(SYSDATE), -:2), :3)', [
      ...operacao,
    ])
  }
  await semearNotas(executar)
  for (const versao of VERSOES_DE_PRECO) {
    await executar('INSERT INTO TGFTAB VALUES (:1, :2, ADD_MONTHS(TRUNC(SYSDATE), :3) + :4)', [
      ...versao,
    ])
  }
  for (const preco of PRECOS) {
    await executar('INSERT INTO TGFEXC VALUES (:1, :2, :3)', [...preco])
  }
}
