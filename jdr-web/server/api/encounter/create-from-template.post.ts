// server/api/encounter/create-from-template.post.ts
import { z } from 'zod'
import { findTemplate, generateVariants } from '~/lib/expand/monsterExpander'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const bodySchema = z.object({
  gameId: z.string().min(1),
  templateId: z.string().min(1),
  count: z.number().int().min(1).default(1),
  seed: z.string().optional(),
  statModifiers: z.array(z.object({ key: z.string(), min: z.number().int(), max: z.number().int() })).optional(),
  varyAllStats: z.boolean().optional(),
  hpScale: z.union([z.number(), z.literal('proportional')]).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const p = bodySchema.parse(body)

  // 1) trouve template
  const template = await findTemplate(p.templateId)
  if (!template) return createError({ statusCode: 404, statusMessage: 'Template not found' })

  // 2) génère variants
  const variants = generateVariants(template, {
    count: p.count,
    seed: p.seed,
    statModifiers: p.statModifiers,
    varyAllStats: p.varyAllStats,
    hpScale: p.hpScale as any
  })

  // 3) crée encounter
  const enc = await prisma.encounter.create({
    data: {
      gameId: p.gameId,
      round: 0,
      turnOrder: JSON.stringify(variants.map(v => v.instanceId)),
      surprise: null,
      state: 'running'
    }
  })

  // 4) enregistre chaque monstre comme Character (MONSTRE)
  for (const v of variants) {
    await prisma.character.create({
      data: {
        gameId: p.gameId,
        kind: 'MONSTRE',
        name: v.name ?? (v.templateId ?? 'Monstre'),
        level: 0,
        hpCurrent: v.hp?.current ?? (v.hp?.max ?? 1),
        hpMax: v.hp?.max ?? (v.hp?.current ?? 1),
        ac: v.ac ?? 10,
        stats: JSON.stringify(v.stats || {}),
        inventory: JSON.stringify([]) // vide par défaut
      }
    })
  }

  return { ok: true, encounterId: enc.id, count: variants.length, variants }
})
