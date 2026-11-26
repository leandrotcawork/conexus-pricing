import assert from 'node:assert/strict'
import type { Aviso, SituacaoRodada } from '../dominio/rodada.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

const DIA_MS = 86_400_000

export const EAN_101 = '2000000000011'
export const EAN_REPETIDO = '2000000000028'

const CATALOGO = [
  {
    codprod: '101',
    ean: EAN_101,
    descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
    marca: 'MARCA ALFA',
    referenciaFabricante: 'REF-101',
    nossoPrecoCentavos: 10_000,
  },
  {
    codprod: '102',
    ean: '2000000000012',
    descricao: 'Chuveiro Elétrico de Teste 100%',
    marca: 'Marca Beta',
  },
  { codprod: '103', ean: EAN_REPETIDO, descricao: 'CABO DE TESTE 10M', nossoPrecoCentavos: 3_000 },
  { codprod: '104', ean: '2000000000035', descricao: 'PRODUTO NOVO SEM COLETA' },
  { codprod: '105', ean: EAN_REPETIDO, descricao: 'CABO DE TESTE 10M NA CAIXA' },
]

const PAGINADOS = Array.from({ length: 45 }, (_, indice) => ({
  codprod: String(201 + indice),
  ean: String(2_000_000_200_000 + indice),
  descricao: `ITEM DE PAGINA ${indice < 40 ? 'QUARENTA' : 'RESTO'} ${indice + 1}`,
  marca: 'MARCA PAGINADA',
}))

type Observada = Omit<typeof observacao.$inferInsert, 'rodadaId' | 'produtoId' | 'coletadoEm'>

type RodadaDeTeste = {
  readonly loja: string
  readonly haDias: number
  readonly situacao: SituacaoRodada
  readonly avisos?: readonly Aviso[]
  readonly observadas: Readonly<Record<string, Observada>>
}

function ok(precoCentavos: number): Observada {
  return { situacao: 'OK', precoCentavos }
}

const NA_TELHANORTE: readonly RodadaDeTeste[] = [
  { loja: 'telhanorte', haDias: 120, situacao: 'CONCLUIDA', observadas: { 101: ok(5_000) } },
  { loja: 'telhanorte', haDias: 60, situacao: 'CONCLUIDA', observadas: { 101: ok(9_000) } },
  { loja: 'telhanorte', haDias: 30, situacao: 'CONCLUIDA', observadas: { 101: ok(8_000) } },
  { loja: 'telhanorte', haDias: 23, situacao: 'INTERROMPIDA', observadas: { 101: ok(100) } },
  {
    loja: 'telhanorte',
    haDias: 16,
    situacao: 'SUSPEITA',
    observadas: { 101: { situacao: 'ERRO', detalhe: 'HTTP 500' } },
  },
  { loja: 'telhanorte', haDias: 9, situacao: 'CONCLUIDA', observadas: { 101: ok(8_000) } },
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
    },
  },
  { loja: 'telhanorte', haDias: 1, situacao: 'RODANDO', observadas: { 101: ok(200) } },
]

const NAS_OUTRAS: readonly RodadaDeTeste[] = [
  {
    loja: 'condec',
    haDias: 9,
    situacao: 'CONCLUIDA',
    observadas: {
      101: ok(12_001),
      102: { situacao: 'ERRO', detalhe: 'HTTP 500' },
      103: ok(2_000),
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
    },
  },
  { loja: 'antiga', haDias: 2, situacao: 'CONCLUIDA', observadas: { 101: ok(1) } },
]

async function gravarRodada(dono: Banco, agora: number, pedida: RodadaDeTeste): Promise<void> {
  const lojas = await dono.select().from(fonte)
  const produtos = await dono.select().from(produto)
  const em = new Date(agora - pedida.haDias * DIA_MS)
  const loja = lojas.find(({ codigo }) => codigo === pedida.loja)
  assert.ok(loja)
  const [criada] = await dono
    .insert(rodada)
    .values({
      fonteId: loja.id,
      agendadaPara: em,
      situacao: pedida.situacao,
      iniciadaEm: em,
      sinalEm: em,
      concluidaEm: pedida.situacao === 'RODANDO' ? null : em,
      contagens: {},
      avisos: pedida.avisos ?? [],
      versao: 'teste',
    })
    .returning({ id: rodada.id })
  assert.ok(criada)
  await dono.insert(observacao).values(
    Object.entries(pedida.observadas).map(([codprod, observada]) => {
      const item = produtos.find((p) => p.codprod === codprod)
      assert.ok(item)
      return { ...observada, rodadaId: criada.id, produtoId: item.id, coletadoEm: em }
    }),
  )
}

/**
 * Um catálogo inventado com meses de rodadas, além das três lojas das migrações: `nova` nunca
 * rodou e `antiga` está inativa.
 */
export async function abrirBancoDeLeitura(urlBase: string) {
  const descartavel = await criarBancoDescartavel(urlBase)
  await descartavel.migrar()
  const dono = abrirBanco(descartavel.urls.dono)
  await dono.insert(produto).values([...CATALOGO, ...PAGINADOS])
  await dono.insert(fonte).values([
    { codigo: 'nova', nome: 'Loja Nova', plataforma: 'vtex', config: {} },
    { codigo: 'antiga', nome: 'Loja Antiga', plataforma: 'vtex', config: {}, ativa: false },
  ])
  const agora = Date.now()
  for (const pedida of [...NA_TELHANORTE, ...NAS_OUTRAS]) await gravarRodada(dono, agora, pedida)
  await fecharBanco(dono)
  return {
    urlDoLeitor: descartavel.urls.leitor,
    haDias: (dias: number) => new Date(agora - dias * DIA_MS).toISOString(),
    apagar: () => descartavel.apagar(),
  }
}
