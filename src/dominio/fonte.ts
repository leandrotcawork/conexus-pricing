import type { FonteCodigo, FonteId } from './marcas.ts'

export const PLATAFORMAS = ['vtex', 'tray', 'wake'] as const
export type Plataforma = (typeof PLATAFORMAS)[number]

export type Fonte = {
  readonly id: FonteId
  readonly codigo: FonteCodigo
  readonly nome: string
  readonly plataforma: Plataforma
  readonly config: unknown // só o adaptador da plataforma faz o parse (code C27)
  readonly ativa: boolean
}
