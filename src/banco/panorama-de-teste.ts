/** Catálogos pequenos, com preços escolhidos para cada indicador se conferir à mão. */
import type { Observada, RodadaDeTeste } from './semente-de-teste.ts'
import { abrirBancoSemeado, ok } from './semente-de-teste.ts'

const NAO: Observada = { situacao: 'NAO_ENCONTRADO' }

function categoria(codigo: number, nome: string, pai: number | null) {
  return { codigo, nome, pai, grau: 1, analitico: true, ativo: true }
}

function item(codprod: string, resto: { descricao: string; marca?: string; grupoCodigo?: number }) {
  return { codprod, ean: `20000000003${codprod.padStart(2, '0')}`, ...resto }
}

/** Uma semana de coleta: quatro produtos nas três lojas das migrações. */
export async function abrirUmaSemana(urlBase: string) {
  const banco = await abrirBancoSemeado(urlBase, {
    grupos: [
      categoria(10, 'Revestimentos', null),
      categoria(11, 'Porcelanatos', 10),
      categoria(20, 'Hidráulica', null),
    ],
    produtos: [
      {
        ...item('1', { descricao: 'PISO UM', marca: 'ALFA', grupoCodigo: 10 }),
        nossoPrecoCentavos: 11_000,
        venda12mCentavos: 300,
      },
      {
        ...item('2', { descricao: 'PISO DOIS', marca: 'BETA', grupoCodigo: 11 }),
        nossoPrecoCentavos: 20_000,
        venda12mCentavos: 100,
      },
      item('3', { descricao: 'TUBO SEM PRECO NOSSO', marca: 'ALFA', grupoCodigo: 20 }),
      { ...item('4', { descricao: 'AVULSO' }), nossoPrecoCentavos: 5_000, venda12mCentavos: 0 },
    ],
  })
  const em = new Date('2026-10-28T12:00:00Z')
  function nas(loja: string, observadas: Record<string, Observada>): RodadaDeTeste {
    return { loja, em, situacao: 'CONCLUIDA', observadas }
  }
  await banco.gravar([
    nas('abc', {
      1: { ...ok(10_000), precoListaCentavos: 12_000 },
      2: ok(25_000),
      3: ok(700),
      4: NAO,
    }),
    nas('condec', {
      1: ok(11_000),
      2: { situacao: 'SEM_ESTOQUE', precoCentavos: 100 },
      3: { situacao: 'ERRO', detalhe: 'HTTP 500' },
      4: NAO,
    }),
    nas('telhanorte', { 1: ok(12_000), 2: NAO, 4: NAO }),
  ])
  return banco
}

const PRIMEIRA_SEGUNDA = Date.parse('2026-09-07T12:00:00Z')
const DIA_MS = 86_400_000

/** O dia `dia` (0 é segunda) da semana `semana`, contada de 1. */
function diaDe(semana: number, dia = 2): Date {
  return new Date(PRIMEIRA_SEGUNDA + ((semana - 1) * 7 + dia) * DIA_MS)
}

/**
 * As rodadas de uma semana: o produto 1 custa 100 reais nas quatro primeiras e 80 depois, e o 2,
 * sem preço nosso, muda nas duas lojas entre a sétima e a oitava.
 */
function daSemana(semana: number): readonly RodadaDeTeste[] {
  const tardia = semana >= 8
  const abc: RodadaDeTeste = {
    loja: 'abc',
    em: diaDe(semana),
    situacao: 'CONCLUIDA',
    observadas: { 1: ok(semana <= 4 ? 10_000 : 8_000), 2: ok(tardia ? 2_500 : 2_000) },
  }
  const condec: RodadaDeTeste = {
    loja: 'condec',
    em: diaDe(semana),
    situacao: 'SUSPEITA',
    observadas: { 2: ok(tardia ? 3_000 : 4_000) },
  }
  return [abc, condec]
}

/** Dois produtos, sem rodada nenhuma até `gravarSemanas`. */
export async function abrirHistorico(urlBase: string) {
  const banco = await abrirBancoSemeado(urlBase, {
    produtos: [
      { ...item('1', { descricao: 'PISO UM' }), nossoPrecoCentavos: 10_000 },
      item('2', { descricao: 'PISO DOIS' }),
    ],
  })
  return {
    ...banco,
    async gravarSemanas(semanas: readonly number[]): Promise<void> {
      await banco.gravar(semanas.flatMap(daSemana))
    },
    /** Outra rodada da loja numa semana que já tem uma mais nova: não conta. */
    async gravarRepetida(semana: number): Promise<void> {
      const observadas = { 1: ok(1), 2: ok(1) }
      await banco.gravar([{ loja: 'abc', em: diaDe(semana, 0), situacao: 'CONCLUIDA', observadas }])
    },
  }
}
