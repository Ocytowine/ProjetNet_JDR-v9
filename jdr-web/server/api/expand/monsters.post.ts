// server/api/expand/monsters.post.ts
import { findTemplate, generateVariants } from '~/lib/expand/monsterExpander'
import { z } from 'zod'

const bodySchema = z.object({
  templateId: z.string(),
  count: z.number().int().min(1).default(1),
  seed: z.string().optional(),
  statModifiers: z.array(z.object({ key: z.string(), min: z.number().int(), max: z.number().int() })).optional(),
  varyAllStats: z.boolean().optional(),
  hpScale: z.union([z.number(), z.literal('proportional')]).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = bodySchema.parse(body)

  const template = await findTemplate(parsed.templateId)
  if (!template) return createError({ statusCode: 404, statusMessage: 'Template not found' })

  const variants = generateVariants(template, {
    count: parsed.count,
    seed: parsed.seed,
    statModifiers: parsed.statModifiers,
    varyAllStats: parsed.varyAllStats,
    hpScale: parsed.hpScale as any
  })

  return { ok: true, count: variants.length, variants }
})
