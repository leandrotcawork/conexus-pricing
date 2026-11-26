import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { z } from 'zod'
import { abrirBancoDeLeitura, EAN_101 } from '../banco/leituras-de-teste.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { conectar } from '../funcoes/mcp-de-teste.ts'

let banco: Awaited<ReturnType<typeof abrirBancoDeLeitura>>
let mcp: Awaited<ReturnType<typeof conectar>>

before(async () => {
  banco = await abrirBancoDeLeitura(urlDoBancoDeTeste())
  mcp = await conectar(banco.urlDoLeitor)
})

after(async () => {
  await mcp.cliente.close()
  await banco.apagar()
})

const Precos = z.object({
  lojas: z.array(z.looseObject({ loja: z.string(), situacao: z.string() })),
  lojasSemColeta: z.array(z.string()),
})

const Estatisticas = z.object({
  atual: z.record(z.string(), z.number().nullable()),
  porLoja: z.array(z.looseObject({ loja: z.string() })),
})

const Saude = z.object({
  lojas: z.array(
    z.object({
      loja: z.string(),
      nome: z.string(),
      ativa: z.boolean(),
      ultimaRodada: z.looseObject({ idadeHoras: z.number() }).nullable(),
    }),
  ),
})

async function estatisticas(codprod: string, dias?: number) {
  const argumentos = { produto: { codprod }, ...(dias === undefined ? {} : { dias }) }
  return Estatisticas.parse(await mcp.responder('estatisticas_preco', argumentos))
}

function semPreco(loja: string, situacaoAtual: string | null) {
  return {
    loja,
    situacaoAtual,
    precoAtual: null,
    mesmoPrecoDesde: null,
    minimoNoPeriodo: null,
    maximoNoPeriodo: null,
  }
}

function daRodada(dias: number, situacao: string) {
  const em = banco.haDias(dias)
  return { coletadoEm: em, rodada: { agendadaPara: em, situacao } }
}

describe('precos_atuais', () => {
  test('traz cada loja ativa pela última rodada concluída ou suspeita', async () => {
    const semOferta = { precoLista: null, vendedor: null, url: null, detalhe: null }
    assert.deepEqual(await mcp.responder('precos_atuais', { produto: { ean: EAN_101 } }), {
      produto: {
        codprod: '101',
        ean: EAN_101,
        descricao: 'TORNEIRA ELETRICA DE TESTE 220V',
        nossoPreco: 100,
      },
      lojas: [
        {
          loja: 'abc',
          nome: 'ABC da Construção',
          situacao: 'SEM_ESTOQUE',
          preco: 1,
          ...semOferta,
          ...daRodada(3, 'SUSPEITA'),
        },
        // a rodada FALHOU de dois dias atrás não substitui a de nove
        {
          loja: 'condec',
          nome: 'Condec',
          situacao: 'OK',
          preco: 120.01,
          ...semOferta,
          ...daRodada(9, 'CONCLUIDA'),
        },
        // nem a que ainda está rodando
        {
          loja: 'telhanorte',
          nome: 'Telha Norte',
          situacao: 'OK',
          preco: 80,
          precoLista: 85,
          vendedor: 'Vendedor Inventado',
          url: 'https://loja.teste/101',
          detalhe: null,
          ...daRodada(2, 'CONCLUIDA'),
        },
      ],
      lojasSemColeta: ['nova'],
    })
  })

  test('a loja que não vende é distinta da coleta que falhou', async () => {
    const lido = await mcp.responder('precos_atuais', { produto: { codprod: '102' } })
    const lojas = Precos.parse(lido).lojas.map((l) => [l.loja, l.situacao, l.preco, l.detalhe])
    assert.deepEqual(lojas, [
      ['abc', 'OK', 15, null],
      ['condec', 'ERRO', null, 'HTTP 500'],
      ['telhanorte', 'NAO_ENCONTRADO', null, null],
    ])
  })

  test('o produto que nenhuma rodada perguntou fica em lojasSemColeta', async () => {
    const lido = await mcp.responder('precos_atuais', { produto: { codprod: '104' } })
    assert.partialDeepStrictEqual(lido, {
      lojas: [],
      lojasSemColeta: ['abc', 'condec', 'nova', 'telhanorte'],
    })
  })
})

describe('estatisticas_preco', () => {
  test('resume só o que está à venda, contra o nosso preço', async () => {
    const { atual } = await estatisticas('103')
    assert.deepEqual(atual, {
      lojasComPreco: 3,
      minimo: 10,
      maximo: 90,
      media: 40,
      mediana: 20,
      nossoPreco: 30,
      nossoContraMedianaPct: 50,
    })
  })

  test('com duas lojas, a mediana é o meio; o sem estoque e a loja inativa não entram', async () => {
    const { atual, porLoja } = await estatisticas('101')
    assert.deepEqual(atual, {
      lojasComPreco: 2,
      minimo: 80,
      maximo: 120.01,
      media: 100.01,
      mediana: 100.01,
      nossoPreco: 100,
      nossoContraMedianaPct: -0.01,
    })
    assert.deepEqual(porLoja, [
      semPreco('abc', 'SEM_ESTOQUE'),
      {
        loja: 'condec',
        situacaoAtual: 'OK',
        precoAtual: 120.01,
        mesmoPrecoDesde: banco.haDias(9),
        minimoNoPeriodo: 120.01,
        maximoNoPeriodo: 120.01,
      },
      semPreco('nova', null),
      // o erro e a rodada interrompida no meio não quebram a sequência de 80
      {
        loja: 'telhanorte',
        situacaoAtual: 'OK',
        precoAtual: 80,
        mesmoPrecoDesde: banco.haDias(30),
        minimoNoPeriodo: 80,
        maximoNoPeriodo: 90,
      },
    ])
  })
})

describe('estatisticas_preco fora do caso comum', () => {
  test('o período pedido limita o mínimo, o máximo e o desde quando', async () => {
    const ano = await estatisticas('101', 365)
    assert.partialDeepStrictEqual(ano.porLoja[3], {
      mesmoPrecoDesde: banco.haDias(30),
      minimoNoPeriodo: 50,
      maximoNoPeriodo: 90,
    })
    const semana = await estatisticas('101', 7)
    assert.partialDeepStrictEqual(semana.porLoja[3], {
      mesmoPrecoDesde: banco.haDias(2),
      minimoNoPeriodo: 80,
      maximoNoPeriodo: 80,
    })
    // o preço atual é o da última rodada, mesmo mais velha que o período
    assert.partialDeepStrictEqual(semana.porLoja[1], {
      precoAtual: 120.01,
      mesmoPrecoDesde: null,
      minimoNoPeriodo: null,
    })
  })

  test('sem o nosso preço não há comparação, e cada loja diz por que está sem preço', async () => {
    const { atual, porLoja } = await estatisticas('102')
    assert.partialDeepStrictEqual(atual, { lojasComPreco: 1, nossoContraMedianaPct: null })
    assert.deepEqual(porLoja.slice(1), [
      semPreco('condec', 'ERRO'),
      semPreco('nova', null),
      semPreco('telhanorte', 'NAO_ENCONTRADO'),
    ])
  })

  test('sem preço em loja nenhuma, o resumo é nulo', async () => {
    const { atual } = await estatisticas('104')
    assert.partialDeepStrictEqual(atual, {
      lojasComPreco: 0,
      minimo: null,
      mediana: null,
      nossoContraMedianaPct: null,
    })
  })
})

function contagens(outras: Record<string, number>) {
  return { OK: 0, SEM_ESTOQUE: 0, SEM_PRECO: 0, NAO_ENCONTRADO: 0, ERRO: 0, ...outras }
}

describe('saude_coleta', () => {
  test('mostra a última rodada de cada loja em qualquer situação', async () => {
    const { lojas } = Saude.parse(await mcp.responder('saude_coleta', {}))
    assert.deepEqual(
      lojas.map(({ loja, ativa }) => [loja, ativa]),
      [
        ['abc', true],
        ['antiga', false],
        ['condec', true],
        ['nova', true],
        ['telhanorte', true],
      ],
    )
    const [abc, , condec, nova, telhanorte] = lojas
    assert.partialDeepStrictEqual(abc?.ultimaRodada, {
      situacao: 'SUSPEITA',
      agendadaPara: banco.haDias(3),
      concluidaEm: banco.haDias(3),
      contagens: contagens({ OK: 2, SEM_ESTOQUE: 1 }),
      avisos: [
        'os produtos com preço caíram de 10 para 2',
        'a coleta usou o token reserva da loja, porque não achou o token na home',
      ],
    })
    assert.partialDeepStrictEqual(condec?.ultimaRodada, {
      situacao: 'FALHOU',
      contagens: contagens({ ERRO: 1 }),
      avisos: ['nenhum produto voltou com preço, e 1 deram erro'],
    })
    assert.equal(nova?.ultimaRodada, null)
    assert.partialDeepStrictEqual(telhanorte?.ultimaRodada, {
      situacao: 'RODANDO',
      concluidaEm: null,
      contagens: contagens({ OK: 1 }),
    })
    // três dias desde o fecho; um dia desde o início da que roda
    assert.equal(Math.round(abc?.ultimaRodada?.idadeHoras ?? 0), 72)
    assert.equal(Math.round(telhanorte?.ultimaRodada?.idadeHoras ?? 0), 24)
  })

  test('uma loja só, quando pedida', async () => {
    const { lojas } = Saude.parse(await mcp.responder('saude_coleta', { loja: 'condec' }))
    assert.deepEqual(
      lojas.map(({ loja }) => loja),
      ['condec'],
    )
  })
})
