import type { Plataforma } from '../dominio/fonte.ts'
import type { Adaptador } from './contrato.ts'
import { tray } from './tray/adaptador.ts'
import { vtex } from './vtex/adaptador.ts'
import { wake } from './wake/adaptador.ts'

export const ADAPTADORES: { readonly [P in Plataforma]: Adaptador } = { vtex, tray, wake }
