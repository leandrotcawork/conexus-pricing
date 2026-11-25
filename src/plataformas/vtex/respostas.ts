import { z } from 'zod'

export const Busca = z.array(
  z.object({
    link: z.string(),
    items: z.array(
      z.object({
        ean: z.string().nullish(),
        sellers: z.array(
          z.object({
            sellerName: z.string(),
            commertialOffer: z.object({
              Price: z.number(),
              ListPrice: z.number(),
              IsAvailable: z.boolean(),
            }),
          }),
        ),
      }),
    ),
  }),
)
export type Busca = z.infer<typeof Busca>
