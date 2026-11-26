import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { ne } from 'drizzle-orm'
import { z } from 'zod'
import { fontesDasMigracoes } from '../../scripts/fontes.ts'
import { urlDoBancoDeTeste } from '../config.ts'
import { ADAPTADORES } from '../plataformas/registro.ts'
import type { Banco } from './conexao.ts'
import { abrirBanco, fecharBanco } from './conexao.ts'
import { criarBancoDescartavel } from './descartavel.ts'
import { fonte, observacao, produto, rodada } from './tabelas.ts'

const Recusa = z.object({
  cause: z.object({ code: z.string(), constraint: z.string().optional() }),
})

// o driver sempre traz o campo `constraint`; numa recusa por permissão ele vem vazio
const SEM_PERMISSAO = { code: '42501', constraint: undefined }

/** O código do Postgres e a restrição que recusou, ou 'aceito'. */
async function recusa(operacao: PromiseLike<unknown>) {
  try {
    await operacao
  } catch (erro) {
    return Recusa.parse(erro).cause
  }
  return 'aceito'
}

const AGENDADA = new Date('2026-01-05T09:00:00Z')
const SEMANA_SEGUINTE = new Date('2026-01-12T09:00:00Z')

function novaRodada(fonteId: number, agendadaPara: Date) {
  return {
    fonteId,
    agendadaPara,
    situacao: 'RODANDO' as const,
    iniciadaEm: agendadaPara,
    sinalEm: agendadaPara,
    contagens: {},
    avisos: [],
    versao: 'teste',
  }
}

let descartavel: Awaited<ReturnType<typeof criarBancoDescartavel>>
let primeiraSaida: string
let dono: Banco
let coletor: Banco
let leitor: Banco
let ids: { fonte: number; produto: number; rodada: number; rodadaDasRecusas: number }

before(async () => {
  descartavel = await criarBancoDescartavel(urlDoBancoDeTeste())
  primeiraSaida = await descartavel.migrar()
  dono = abrirBanco(descartavel.urls.dono)
  coletor = abrirBanco(descartavel.urls.coletor)
  leitor = abrirBanco(descartavel.urls.leitor)
  const [loja] = await dono
    .insert(fonte)
    .values({ codigo: 'lojateste', nome: 'Loja de teste', plataforma: 'vtex', config: {} })
    .returning()
  const [item] = await dono
    .insert(produto)
    .values({ codprod: '1', ean: '2000000000015', descricao: 'Item de teste' })
    .returning()
  assert.ok(loja && item)
  const [aberta, dasRecusas] = await coletor
    .insert(rodada)
    .values([novaRodada(loja.id, AGENDADA), novaRodada(loja.id, SEMANA_SEGUINTE)])
    .returning()
  assert.ok(aberta && dasRecusas)
  ids = { fonte: loja.id, produto: item.id, rodada: aberta.id, rodadaDasRecusas: dasRecusas.id }
})

after(async () => {
  for (const banco of [dono, coletor, leitor]) await fecharBanco(banco)
  await descartavel.apagar()
})

describe('scripts/migrar.ts', () => {
  test('a primeira execução aplica as migrações e a segunda não aplica nada', async () => {
    assert.match(
      primeiraSaida,
      /^migrações aplicadas: 5 \S+_inicial \S+_roles \S+_fontes \S+_observacao_por_produto \S+_fontes_novas$/m,
    )
    assert.match(primeiraSaida, /^senhas definidas: precos_coletor precos_leitor$/m)
    const segundaSaida = await descartavel.migrar()
    assert.match(segundaSaida, /^migrações aplicadas: 0$/m)
  })
})

describe('as lojas das migrações', () => {
  test('são as que o lote de ensaio lê, e cada config abre no seu adaptador', async () => {
    const { codigo, plataforma, config } = fonte
    const noBanco = await dono
      .select({ codigo, plataforma, config })
      .from(fonte)
      .where(ne(codigo, 'lojateste'))
      .orderBy(codigo)
    const semeadas = fontesDasMigracoes().toSorted((a, b) => a.codigo.localeCompare(b.codigo))

    assert.deepEqual(semeadas, noBanco)
    assert.deepEqual(
      noBanco.map((loja) => loja.codigo),
      ['abc', 'amoedo', 'balaroti', 'condec', 'copafer', 'queroquero', 'telhanorte'],
    )
    for (const loja of semeadas) {
      assert.equal(ADAPTADORES[loja.plataforma].abrir(loja.config).tipo, 'ABERTO', loja.codigo)
    }
  })
})

describe('roles', () => {
  test('precos_leitor lê as tabelas e recebe 42501 num INSERT', async () => {
    for (const tabela of [produto, fonte, rodada, observacao]) {
      await leitor.select().from(tabela)
    }
    const insercao = leitor
      .insert(fonte)
      .values({ codigo: 'outra', nome: 'Outra', plataforma: 'tray', config: {} })
    assert.deepEqual(await recusa(insercao), SEM_PERMISSAO)
  })

  test('precos_coletor grava rodada e observação', async () => {
    await coletor
      .insert(observacao)
      .values({ rodadaId: ids.rodada, produtoId: ids.produto, situacao: 'NAO_ENCONTRADO' })
    await coletor.update(observacao).set({ situacao: 'SEM_ESTOQUE', precoCentavos: 100 })
    await coletor.update(observacao).set({ situacao: 'OK', precoListaCentavos: 120 })
    await coletor.update(rodada).set({ sinalEm: new Date() })
  })

  test('precos_coletor não escreve no catálogo nem apaga rodada', async () => {
    const noCatalogo = coletor
      .insert(produto)
      .values({ codprod: '2', ean: '2000000000022', descricao: 'Outro' })
    assert.deepEqual(await recusa(noCatalogo), SEM_PERMISSAO)
    assert.deepEqual(await recusa(coletor.update(fonte).set({ ativa: false })), SEM_PERMISSAO)
    assert.deepEqual(await recusa(coletor.delete(rodada)), SEM_PERMISSAO)
  })
})

describe('o banco recusa preço falso', () => {
  const casos = [
    ['preço zero', { situacao: 'OK', precoCentavos: 0 }, 'observacao_preco_positivo'],
    [
      'preço de lista zero',
      { situacao: 'OK', precoCentavos: 100, precoListaCentavos: 0 },
      'observacao_preco_positivo',
    ],
    ['OK sem preço', { situacao: 'OK' }, 'observacao_com_preco_tem_preco'],
    ['sem estoque sem preço', { situacao: 'SEM_ESTOQUE' }, 'observacao_com_preco_tem_preco'],
    [
      'sem estoque com preço de lista',
      { situacao: 'SEM_ESTOQUE', precoCentavos: 100, precoListaCentavos: 120 },
      'observacao_preco_lista_so_no_ok',
    ],
    [
      'sem preço com preço de lista',
      { situacao: 'SEM_PRECO', precoListaCentavos: 120 },
      'observacao_preco_lista_so_no_ok',
    ],
    [
      'não encontrado com preço',
      { situacao: 'NAO_ENCONTRADO', precoCentavos: 100 },
      'observacao_sem_preco_sem_valor',
    ],
    [
      'erro com preço',
      { situacao: 'ERRO', detalhe: 'falha', precoCentavos: 100 },
      'observacao_sem_preco_sem_valor',
    ],
    ['erro sem detalhe', { situacao: 'ERRO' }, 'observacao_erro_tem_detalhe'],
  ] as const

  for (const [nome, valores, restricao] of casos) {
    test(nome, async () => {
      const insercao = coletor
        .insert(observacao)
        .values({ ...valores, rodadaId: ids.rodadaDasRecusas, produtoId: ids.produto })
      assert.deepEqual(await recusa(insercao), { code: '23514', constraint: restricao })
    })
  }

  test('nosso preço zero', async () => {
    const zerado = dono
      .insert(produto)
      .values({ codprod: '3', ean: '2000000000039', descricao: 'Zerado', nossoPrecoCentavos: 0 })
    assert.deepEqual(await recusa(zerado), {
      code: '23514',
      constraint: 'produto_nosso_preco_positivo',
    })
  })
})

describe('a rodada', () => {
  test('é uma só por loja e horário agendado', async () => {
    const repetida = coletor.insert(rodada).values(novaRodada(ids.fonte, AGENDADA))
    assert.deepEqual(await recusa(repetida), {
      code: '23505',
      constraint: 'rodada_uma_por_agendamento',
    })
  })

  test('rodando não tem data de conclusão', async () => {
    const concluida = coletor.update(rodada).set({ concluidaEm: SEMANA_SEGUINTE })
    assert.deepEqual(await recusa(concluida), {
      code: '23514',
      constraint: 'rodada_aberta_so_rodando',
    })
  })
})
