
import { z } from 'zod'

const base = {
  id: z.string().min(1),
  gameId: z.string().min(1),
  type: z.string().min(1),
  payload: z.any(),
  meta: z.object({
    confidence: z.number().min(0).max(1).optional(),
    requiresConfirmation: z.boolean().optional(),
    sourceMsgId: z.string().optional()
  }).optional()
}

export const buyItem = z.object({
  ...base,
  type: z.literal('BUY_ITEM'),
  payload: z.object({
    buyerId: z.string(),
    itemId: z.string(),
    qty: z.number().int().positive(),
    price: z.number().optional(),
    vendorId: z.string().optional()
  })
})

export const createQuest = z.object({
  ...base,
  type: z.literal('CREATE_QUEST'),
  payload: z.object({
    title: z.string(),
    description: z.string().optional(),
    reward: z.union([z.string(), z.number()]).optional(),
    importance: z.enum(['low','med','high']),
    tags: z.array(z.string()).optional()
  })
})

export const combatSurpriseEnemy = z.object({
  ...base,
  type: z.literal('COMBAT_SURPRISE_ENEMY'),
  payload: z.object({
    locationId: z.string().optional(),
    enemies: z.array(z.string()).min(1),
    surprise: z.literal('enemy')
  })
})

export const commandSchema = z.discriminatedUnion('type', [buyItem, createQuest, combatSurpriseEnemy])
export type Command = z.infer<typeof commandSchema>
