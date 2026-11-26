import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { z } from 'zod'
import { fonteDasMigracoes } from '../../../scripts/fontes.ts'
import { decidir } from '../../dominio/observacao.ts'
import type { Cadastro } from '../conformidade.ts'
import { abrirLotes, conformidade, EAN_A, EAN_B, gravacaoDe, lido } from '../conformidade.ts'
import { vtex } from './adaptador.ts'
import { Busca } from './respostas.ts'

const GRAVACOES = new URL('./gravacoes/', import.meta.url)
const ORIGEM = 'https://www.telhanorte.com.br'
const CONFIG = { origem: ORIGEM, lote: 50 }

function comCadastro(corpo: string, { ean, reais, disponivel }: Cadastro): string {
  const busca = Busca.parse(JSON.parse(corpo))
  const modelo = busca.find((produto) => produto.items.some((item) => item.ean === ean))
  const copia = structuredClone(modelo)
  const oferta = copia?.items[0]?.sellers[0]?.commertialOffer
  assert.ok(copia && oferta)
  Object.assign(oferta, { Price: reais, ListPrice: reais, IsAvailable: disponivel })
  return JSON.stringify([...busca, copia])
}

const CAMPOS_INVALIDOS = [{ lote: 51 }, { lote: 0 }, { origem: 'http://www.telhanorte.com.br' }]

conformidade({
  adaptador: vtex,
  gravacoes: GRAVACOES,
  config: CONFIG,
  camposInvalidos: CAMPOS_INVALIDOS,
  origens: [ORIGEM],
  comCadastro,
})

for (const [loja, origem] of [
  ['copafer', 'https://www.copafer.com.br'],
  ['queroquero', 'https://www.queroquero.com.br'],
  ['amoedo', 'https://www.amoedo.com.br'],
] as const) {
  conformidade({
    adaptador: vtex,
    loja,
    gravacoes: new URL(`${loja}/`, GRAVACOES),
    config: z.looseObject({}).parse(fonteDasMigracoes(loja).config),
    camposInvalidos: CAMPOS_INVALIDOS,
    origens: [origem],
    comCadastro,
  })
}

describe('VTEX', () => {
  const { lotes } = abrirLotes(vtex, CONFIG, () => assert.fail('a VTEX não tem preparo'))
  const lote = gravacaoDe(GRAVACOES, 'lote')
  const [primeiro] = z.array(z.unknown()).parse(JSON.parse(lote.corpo))

  test('o pedido filtra os EANs no servidor e pede a página inteira', () => {
    assert.equal(
      lotes.pedido([EAN_A, EAN_B]).url,
      `${ORIGEM}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${EAN_A}` +
        `&fq=alternateIds_Ean:${EAN_B}&_from=0&_to=49`,
    )
  })

  test('a oferta leva preço em centavos, preço de lista, vendedor e endereço', () => {
    assert.deepEqual(decidir(lido(lotes.ler(lote, [EAN_A])).get(EAN_A)), {
      situacao: 'OK',
      preco: 2090,
      precoLista: 2090,
      vendedor: 'Vendedor inventado',
      url: `${ORIGEM}/produto-inventado-1/p`,
      cadastros: 1,
    })
  })

  test('a variante de outro EAN no mesmo produto não empresta o preço', () => {
    const produto = Busca.element.parse(primeiro)
    const variante = structuredClone(produto.items[0])
    assert.ok(variante)
    Object.assign(variante, { ean: EAN_B })
    const corpo = JSON.stringify([{ ...produto, items: [...produto.items, variante] }])
    const cabecalhos = { resources: '0-49/1' }
    const ofertas = lido(lotes.ler({ ...lote, cabecalhos, corpo }, [EAN_A]))
    assert.equal(ofertas.get(EAN_A)?.length, 1)
    assert.equal(ofertas.has(EAN_B), false)
  })

  test('sem o total no cabeçalho não há como saber se veio tudo', () => {
    assert.deepEqual(lotes.ler({ ...lote, cabecalhos: {} }, [EAN_A]), {
      tipo: 'INVALIDO',
      motivo: 'sem o total no cabeçalho resources',
    })
  })

  test('preço zero publicado é SEM_PRECO, não um preço', () => {
    const zerado = Busca.element.parse(structuredClone(primeiro))
    const oferta = zerado.items[0]?.sellers[0]?.commertialOffer
    assert.ok(oferta)
    Object.assign(oferta, { Price: 0, ListPrice: 0 })
    const resposta = {
      ...lote,
      cabecalhos: { resources: '0-49/1' },
      corpo: JSON.stringify([zerado]),
    }
    const ofertas = lido(lotes.ler(resposta, [EAN_A]))
    assert.equal(decidir(ofertas.get(EAN_A)).situacao, 'SEM_PRECO')
  })
})
