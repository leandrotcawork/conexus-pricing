import { z } from 'zod'

const Cadastro = z.object({
  ean: z.string().nullable(),
  alias: z.string().nullable(),
  aliasComplete: z.string().nullable(),
  available: z.boolean(),
  prices: z.object({ price: z.number(), listPrice: z.number() }).nullable(),
})

export const Resposta = z.object({
  errors: z
    .array(z.object({ extensions: z.object({ code: z.string().optional() }).optional() }))
    .optional(),
  data: z
    .object({
      products: z
        .object({
          pageInfo: z.object({ hasNextPage: z.boolean() }),
          edges: z.array(z.object({ node: Cadastro })),
        })
        .nullable(),
    })
    .nullish(),
})
export type Resposta = z.infer<typeof Resposta>
