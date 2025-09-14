// server/api/encounter/start.post.ts
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

// util - seeded PRNG (simple)
function xmur3(str: string) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}
function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// parse stats stored as JSON string, fallback to default values
function parseStats(s?: string) {
  try {
    return s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

const bodySchema = z.object({
  encounterId: z.string().min(1),
  seed: z.string().optional() // for reproducible initiative rolls
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const p = bodySchema.parse(body)

  // fetch encounter
  const enc = await prisma.encounter.findUnique({ where: { id: p.encounterId } })
  if (!enc) return createError({ statusCode: 404, statusMessage: 'Encounter not found' })

  // load characters for this game/encounter
  // we assume characters for this encounter were created with gameId = enc.gameId
  const chars = await prisma.character.findMany({ where: { gameId: enc.gameId } })

  // create seeded RNG
  const seed = p.seed ?? crypto.randomUUID()
  const hasher = xmur3(seed)
  const rand = mulberry32(hasher())

  // compute initiative for each character
  const actors = chars.map(c => {
    const stats = parseStats(c.stats)
    // try dexterity key variants
    const dex = (stats.dexterity ?? stats.dex ?? stats.Dex ?? 10) as number
    const initiativeRoll = Math.floor(rand() * 20) + 1 // 1..20
    const initTotal = initiativeRoll + (Math.floor((dex - 10) / 2) || 0)
    return {
      instanceId: c.id,      // DB id as instance
      name: c.name,
      kind: c.kind,
      hpCurrent: c.hpCurrent,
      hpMax: c.hpMax,
      ac: c.ac,
      stats,
      initiative: {
        roll: initiativeRoll,
        mod: Math.floor((dex - 10) / 2) || 0,
        total: initTotal
      }
    }
  })

  // sort descending by initiative total, tie-breaker by higher dex then random
  actors.sort((a,b) => {
    if (b.initiative.total !== a.initiative.total) return b.initiative.total - a.initiative.total
    const aDex = (a.stats.dexterity ?? a.stats.dex ?? 10) as number
    const bDex = (b.stats.dexterity ?? b.stats.dex ?? 10) as number
    if (bDex !== aDex) return bDex - aDex
    return Math.random() > 0.5 ? 1 : -1
  })

  // persist turnOrder (instance ids) and seed used
  const turnOrder = actors.map(a => a.instanceId)
  await prisma.encounter.update({
    where: { id: enc.id },
    data: { turnOrder: JSON.stringify(turnOrder), round: 1 }
  })

  return { ok: true, encounterId: enc.id, seed, actors, turnOrder }
})
