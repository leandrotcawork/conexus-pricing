import { z } from 'zod'

/** A Tray manda dinheiro como texto com ponto decimal. */
const Reais = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number)

export const Busca = z.object({
  paging: z.object({ total: z.number().int() }),
  Products: z.array(
    z.object({
      Product: z.object({
        ean: z.string().nullable(),
        price: Reais,
        promotional_price: Reais,
        available: z.enum(['0', '1']),
        url: z.object({ https: z.string() }),
      }),
    }),
  ),
})
export type Busca = z.infer<typeof Busca>
