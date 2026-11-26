import type { RodadaDeTeste } from './semente-de-teste.ts'
import { abrirBancoSemeado, ok } from './semente-de-teste.ts'

const DIA_MS = 86_400_000

export const EAN_101 = '2000000000011'
export const EAN_REPETIDO = '2000000000028'

function categoria(codigo: number, nome: string, pai: number | null, analitico = true) {
  return { codigo, nome, pai, grau: 1, analitico, ativo: true }
}

const GRUPOS = [
  categoria(10, 'Revestimentos', null, false),
  categoria(11, 'Porcelanatos', 10, false),
  categoria(12, 'Polidos', 11),
  categoria(13, 'Azulejos', 10),
  categoria(20, 'Hidráulica', null),
  categoria(30, 'Sem produtos', null),
]

const CATALOGO = [
  {
    codprod: '101',
    ean: EAN_101,
    descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
    marca: 'MARCA ALFA',
    grupoCodigo: 12,
    nossoPrecoCentavos: 10_000,
  },
  {
    codprod: '102',
    ean: '2000000000012',
    descricao: 'Chuveiro Elétrico de Teste 100%',
    marca: 'Marca Beta',
    // direto num grupo sintético, que também tem subgrupos
    grupoCodigo: 11,
  },
  {
    codprod: '103',
    ean: EAN_REPETIDO,
    descricao: 'CABO DE TESTE 10M',
    grupoCodigo: 13,
    nossoPrecoCentavos: 3_000,
  },
  { codprod: '104', ean: '2000000000035', descricao: 'PRODUTO NOVO SEM COLETA', grupoCodigo: 20 },
  { codprod: '105', ean: EAN_REPETIDO, descricao: 'CABO DE TESTE 10M NA CAIXA' },
]

const PAGINADOS = Array.from({ length: 120 }, (_, indice) => ({
  codprod: String(201 + indice),
  ean: String(2_000_000_200_000 + indice),
  descricao: `ITEM DE PAGINA ${indice < 100 ? 'CENTENA' : 'RESTO'} PORCELANATO ESMALTADO RETIFICADO 60X120 CM ${indice + 1}`,
  marca: 'MARCA PAGINADA',
  nossoPrecoCentavos: 123_456,
}))

type Antiga = Omit<RodadaDeTeste, 'em'> & { readonly haDias: number }

const NA_TELHANORTE: readonly Antiga[] = [
  { loja: 'telhanorte', haDias: 30, situacao: 'CONCLUIDA', observadas: { 101: ok(9_000) } },
  { loja: 'telhanorte', haDias: 23, situacao: 'INTERROMPIDA', observadas: { 101: ok(100) } },
  { loja: 'telhanorte', haDias: 9, situacao: 'CONCLUIDA', observadas: { 101: ok(7_000) } },
  {
    loja: 'telhanorte',
    haDias: 2,
    situacao: 'CONCLUIDA',
    observadas: {
      101: {
        ...ok(8_000),
        precoListaCentavos: 8_500,
        vendedor: 'Vendedor Inventado',
        url: 'https://loja.teste/101',
        cadastros: 1,
      },
      102: { situacao: 'NAO_ENCONTRADO' },
      103: ok(1_000),
      ...Object.fromEntries(PAGINADOS.map(({ codprod }) => [codprod, ok(123_456)])),
    },
  },
  { loja: 'telhanorte', haDias: 1, situacao: 'RODANDO', observadas: { 101: ok(200) } },
]

const NAS_OUTRAS: readonly Antiga[] = [
  {
    loja: 'condec',
    haDias: 9,
    situacao: 'CONCLUIDA',
    observadas: {
      101: ok(12_001),
      102: { situacao: 'ERRO', detalhe: 'HTTP 500' },
      103: ok(2_000),
      ...Object.fromEntries(PAGINADOS.map(({ codprod }) => [codprod, ok(130_000)])),
    },
  },
  {
    loja: 'condec',
    haDias: 2,
    situacao: 'FALHOU',
    avisos: [{ tipo: 'NENHUM_OK', erros: 1 }],
    observadas: { 101: { situacao: 'ERRO', detalhe: 'HTTP 403' } },
  },
  {
    loja: 'abc',
    haDias: 3,
    situacao: 'SUSPEITA',
    avisos: [{ tipo: 'QUEDA_DE_OK', anterior: 10, atual: 2 }, { tipo: 'TOKEN_RESERVA_EM_USO' }],
    observadas: {
      101: { situacao: 'SEM_ESTOQUE', precoCentavos: 100 },
      102: ok(1_500),
      103: ok(9_000),
      ...Object.fromEntries(
        PAGINADOS.map(({ codprod }) => [codprod, { situacao: 'NAO_ENCONTRADO' } as const]),
      ),
    },
  },
  { loja: 'antiga', haDias: 2, situacao: 'CONCLUIDA', observadas: { 101: ok(1) } },
]

/**
 * Um catálogo inventado com semanas de rodadas em três lojas das migrações, mais `nova`, que nunca
 * rodou, e `antiga`, inativa.
 */
export async function abrirBancoDeLeitura(urlBase: string) {
  const banco = await abrirBancoSemeado(urlBase, {
    grupos: GRUPOS,
    produtos: [...CATALOGO, ...PAGINADOS],
    fontes: [
      { codigo: 'nova', nome: 'Loja Nova', plataforma: 'vtex', config: {} },
      { codigo: 'antiga', nome: 'Loja Antiga', plataforma: 'vtex', config: {}, ativa: false },
    ],
  })
  const agora = Date.now()
  function haDias(dias: number): Date {
    return new Date(agora - dias * DIA_MS)
  }
  await banco.gravar(
    [...NA_TELHANORTE, ...NAS_OUTRAS].map(({ haDias: dias, ...pedida }) => ({
      ...pedida,
      em: haDias(dias),
    })),
  )
  return {
    urlDoLeitor: banco.urlDoLeitor,
    haDias: (dias: number) => haDias(dias).toISOString(),
    apagar: () => banco.apagar(),
  }
}
