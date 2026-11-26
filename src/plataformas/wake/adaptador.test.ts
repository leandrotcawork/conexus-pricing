import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decidir } from '../../dominio/observacao.ts'
import type { Cadastro } from '../conformidade.ts'
import { abrirLotes, conformidade, EAN_A, EAN_B, gravacaoDe, lido } from '../conformidade.ts'
import type { RespostaHttp } from '../contrato.ts'
import { wake } from './adaptador.ts'
import { Resposta } from './respostas.ts'

const GRAVACOES = new URL('./gravacoes/', import.meta.url)
const LOJA = 'https://www.abcdaconstrucao.com.br'
const API = 'https://storefront-api.fbits.net/graphql'
const RESERVA = 'tcs_reserva_inventada_0000000000'
const CONFIG = { loja: LOJA, api: API, lote: 25, tokenReserva: RESERVA }
const home = gravacaoDe(GRAVACOES, 'preparo')
const lote = gravacaoDe(GRAVACOES, 'lote')

function comCadastro(corpo: string, { ean, reais, disponivel }: Cadastro): string {
  const resposta = Resposta.parse(JSON.parse(corpo))
  const products = resposta.data?.products
  const modelo = products?.edges.find(({ node }) => node.ean === ean)
  assert.ok(products && modelo)
  const prices = { price: reais, listPrice: reais }
  const copia = { node: { ...modelo.node, prices, available: disponivel } }
  const edges = [...products.edges, copia]
  return JSON.stringify({ data: { products: { ...products, edges } } })
}

conformidade({
  adaptador: wake,
  gravacoes: GRAVACOES,
  config: CONFIG,
  camposInvalidos: [{ lote: 26 }, { tokenReserva: 'curto' }, { api: 'http://exemplo.invalid' }],
  origens: [LOJA, new URL(API).origin],
  comCadastro,
})

const SEM_RESERVA = { loja: LOJA, api: API, lote: 25 }

describe('Wake: o token de vitrine', () => {
  function preparar(resposta: RespostaHttp | null, config: object = CONFIG) {
    const aberto = wake.abrir(config)
    assert.ok(aberto.tipo === 'ABERTO' && aberto.plano.tipo === 'COM_PREPARO')
    const preparado = aberto.plano.lerPreparo(resposta)
    if (preparado.tipo === 'PREPARO_FALHOU') return preparado
    const { lotes, avisos } = preparado
    return { token: lotes.pedido([EAN_A]).cabecalhos['tcs-access-token'], avisos }
  }

  for (const [nome, config] of [
    ['com', CONFIG],
    ['sem', SEM_RESERVA],
  ] as const) {
    test(`é o que a home da loja declara, ${nome} token reserva na config`, () => {
      const esperado = { token: 'tcs_inventado_00000000000000000000', avisos: [] }
      assert.deepEqual(preparar(home, config), esperado)
    })
  }

  const semToken = [
    { nome: 'a home não respondeu', resposta: null },
    { nome: 'a home respondeu com erro', resposta: { ...home, status: 503 } },
    { nome: 'a home não declara token', resposta: { ...home, corpo: '<!doctype html>' } },
  ]
  for (const { nome, resposta } of semToken) {
    test(`quando ${nome}, usa a reserva e avisa`, () => {
      assert.deepEqual(preparar(resposta), {
        token: RESERVA,
        avisos: [{ tipo: 'TOKEN_RESERVA_EM_USO' }],
      })
    })

    test(`quando ${nome} e não há reserva, o preparo falha com o motivo`, () => {
      assert.deepEqual(preparar(resposta, SEM_RESERVA), {
        tipo: 'PREPARO_FALHOU',
        motivo: 'sem token de vitrine na home da loja e sem tokenReserva na config',
      })
    })
  }
})

describe('Wake: a consulta', () => {
  const { lotes } = abrirLotes(wake, CONFIG, () => home)

  test('vai por POST com os EANs, o teto por página e a origem da loja', () => {
    const { url, metodo, cabecalhos, corpo } = lotes.pedido([EAN_A, EAN_B])
    assert.deepEqual([url, metodo], [API, 'POST'])
    assert.equal(cabecalhos.origin, LOJA)
    assert.equal(cabecalhos.referer, `${LOJA}/`)
    const enviado: { query: string; variables: unknown } = JSON.parse(corpo ?? '')
    assert.match(enviado.query, /pageInfo \{ hasNextPage \}/)
    assert.deepEqual(enviado.variables, { eans: [EAN_A, EAN_B], n: 50 })
  })

  test('a oferta leva preço, preço de lista e o endereço do produto', () => {
    assert.deepEqual(decidir(lido(lotes.ler(lote, [EAN_A])).get(EAN_A)), {
      situacao: 'OK',
      preco: 2090,
      precoLista: 2090,
      vendedor: null,
      url: `${LOJA}/produto/produto-inventado-2`,
      cadastros: 1,
    })
  })

  test('errors com dados junto continua INVALIDO, com o código no motivo', () => {
    const parcial = Resposta.parse(JSON.parse(lote.corpo))
    const errors = [{ extensions: { code: 'HC0051' } }]
    const corpo = JSON.stringify({ ...parcial, errors })
    assert.deepEqual(lotes.ler({ ...lote, corpo }, [EAN_A]), {
      tipo: 'INVALIDO',
      motivo: 'GraphQL com errors: HC0051',
    })
  })

  test('cadastro sem preços é SEM_PRECO', () => {
    const resposta = Resposta.parse(JSON.parse(lote.corpo))
    for (const { node } of resposta.data?.products?.edges ?? []) node.prices = null
    const corpo = JSON.stringify(resposta)
    const ofertas = lido(lotes.ler({ ...lote, corpo }, [EAN_A]))
    assert.equal(decidir(ofertas.get(EAN_A)).situacao, 'SEM_PRECO')
  })
})
