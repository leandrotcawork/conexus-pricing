import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { clienteCrawlee, TETO_BYTES_POR_RESPOSTA } from '../src/coleta/http.ts'
import type { Plataforma } from '../src/dominio/fonte.ts'
import { PLATAFORMAS } from '../src/dominio/fonte.ts'
import { Ean } from '../src/dominio/marcas.ts'
import type { Lotes, PedidoHttp, PlanoDeColeta, RespostaHttp } from '../src/plataformas/contrato.ts'
import type { Caso, Gravador } from '../src/plataformas/gravacao.ts'
import { EAN_SEM_PRODUTO, eansInventados, escreverGravacao } from '../src/plataformas/gravacao.ts'
import { ADAPTADORES } from '../src/plataformas/registro.ts'
import { gravadorTray } from '../src/plataformas/tray/gravacao.ts'
import { gravadorVtex } from '../src/plataformas/vtex/gravacao.ts'
import { gravadorWake } from '../src/plataformas/wake/gravacao.ts'

const GRAVADORES: { readonly [P in Plataforma]: Gravador } = {
  vtex: gravadorVtex,
  tray: gravadorTray,
  wake: gravadorWake,
}
const PAUSA_MS = 3000
const RAIZ = resolve(import.meta.dirname, '..')

const Argumentos = z.tuple([z.enum(PLATAFORMAS), z.string(), Ean, Ean])
const Crua = z.object({
  status: z.number(),
  cabecalhos: z.record(z.string(), z.string().optional()),
  corpo: z.string(),
})

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { cru: { type: 'string' }, destino: { type: 'string' } },
})
const [plataforma, config, ...eans] = Argumentos.parse(positionals)
const destino = resolve(values.destino ?? join(RAIZ, 'src/plataformas', plataforma, 'gravacoes'))

function foraDoRepositorio(pasta: string): string {
  const caminho = resolve(pasta)
  const daRaiz = relative(RAIZ, caminho)
  if (daRaiz.startsWith('..') || isAbsolute(daRaiz)) return caminho
  throw new Error('--cru guarda respostas originais: use uma pasta fora do repositório')
}

const cru = values.cru === undefined ? undefined : foraDoRepositorio(values.cru)
const cliente = clienteCrawlee({
  porMinuto: 20,
  tentativas: 0,
  prazoPedidoMs: 25_000,
  esperaMaximaMs: 0,
  tetoBytes: TETO_BYTES_POR_RESPOSTA,
  prazoFinal: new Date(Date.now() + 5 * 60_000),
})
let pedidosFeitos = 0

async function pedir(caso: Caso, pedido: PedidoHttp): Promise<RespostaHttp> {
  if (pedidosFeitos++ > 0) await esperar(PAUSA_MS)
  let resposta: RespostaHttp | undefined
  let falha = 'sem resposta'
  await cliente.buscar([pedido], async (_, resultado) => {
    if (resultado.tipo === 'RESPONDEU') resposta = resultado.resposta
    else falha = resultado.detalhe
  })
  if (!resposta) throw new Error(`${caso}: ${falha}`)
  return resposta
}

async function capturar(caso: Caso, pedido: PedidoHttp) {
  const arquivo = cru === undefined ? undefined : join(cru, `${caso}.json`)
  if (arquivo && existsSync(arquivo)) {
    const resposta = Crua.parse(JSON.parse(readFileSync(arquivo, 'utf8')))
    return { resposta, data: statSync(arquivo).mtime }
  }
  const resposta = await pedir(caso, pedido)
  if (arquivo) writeFileSync(arquivo, JSON.stringify(resposta))
  return { resposta, data: new Date() }
}

const inventado = eansInventados()
for (const ean of eans) inventado(ean)

async function gravar(caso: Caso, pedido: PedidoHttp): Promise<RespostaHttp> {
  const { resposta, data } = await capturar(caso, pedido)
  const corpo = GRAVADORES[plataforma].inventar({
    caso,
    corpo: resposta.corpo,
    url: pedido.url,
    ean: inventado,
  })
  const url = eans.reduce<string>((texto, ean) => texto.replaceAll(ean, inventado(ean)), pedido.url)
  const texto = escreverGravacao({
    pedido: { ...pedido, url },
    data,
    resposta: { ...resposta, corpo },
  })
  if (eans.some((ean) => texto.includes(ean))) throw new Error(`${caso}: sobrou um EAN real`)
  const arquivo = join(destino, `${caso}.txt`)
  writeFileSync(arquivo, texto)
  console.log(`${resposta.status} ${arquivo}`)
  return resposta
}

const aberto = ADAPTADORES[plataforma].abrir(JSON.parse(config))
if (aberto.tipo === 'CONFIG_INVALIDA') throw new Error(aberto.motivo)
mkdirSync(destino, { recursive: true })
if (cru) mkdirSync(cru, { recursive: true })

async function abrirLotes(plano: PlanoDeColeta): Promise<Lotes> {
  if (plano.tipo === 'DIRETO') return plano.lotes
  const { lotes, avisos } = plano.lerPreparo(await gravar('preparo', plano.preparo))
  for (const aviso of avisos) console.log(`aviso: ${aviso.tipo}`)
  return lotes
}

const lotes = await abrirLotes(aberto.plano)
const gravador = GRAVADORES[plataforma]
const [um] = eans
await gravar('lote', lotes.pedido(eans))
await gravar('vazio', lotes.pedido([Ean.parse(EAN_SEM_PRODUTO)]))
await gravar('truncado', gravador.truncado(lotes.pedido(eans)))
await gravar('erro', gravador.erro(lotes.pedido([um])))
