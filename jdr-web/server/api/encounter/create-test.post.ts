// server/api/encounter/create-test.post.ts
// Crée un encounter "test" : sélection aléatoire de monstres depuis la remote DB,
// génère des variantes, stocke en DB et calcule l'initiative.
// Usage: POST { gameId?, minEnemies?, maxEnemies?, seed?, autoStart? }
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { getMonsters } from '~/lib/content/remoteProvider'
import { generateVariants } from '~/lib/expand/monsterExpander'

const prisma = new PrismaClient()

// seeded RNG helpers
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

const bodySchema = z.object({
  gameId: z.string().optional(),
  minEnemies: z.number().int().min(1).optional().default(1),
  maxEnemies: z.number().int().min(1).optional().default(3),
  seed: z.string().optional(),
  autoStart: z.boolean().optional().default(true)
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  let p
  try { p = bodySchema.parse(body ?? {}) } catch (e:any) { return createError({ statusCode:400, statusMessage: 'Invalid payload', data: e }) }

  const seed = p.seed ?? `test_${Date.now()}`
  const hasher = xmur3(seed)
  const rand = mulberry32(hasher())

  const minE = p.minEnemies
  const maxE = Math.max(p.maxEnemies, minE)
  const count = minE === maxE ? minE : Math.floor(rand() * (maxE - minE + 1)) + minE

  // load remote monsters list (array or object)
  let monstersRaw: any = null
  try { monstersRaw = await getMonsters({ forceRefresh: false }) } catch (err:any) {
    return createError({ statusCode:500, statusMessage: 'Failed to load remote monsters', data: err.message })
  }

  // normalize to array of templates
  let templates: any[] = []
  if (Array.isArray(monstersRaw)) templates = monstersRaw
  else if (monstersRaw && typeof monstersRaw === 'object') templates = Object.values(monstersRaw)
  if (!templates || templates.length === 0) return createError({ statusCode:500, statusMessage: 'No templates in remote monsters' })

  // choose random templates (allow duplicates of type if random picks same)
  const chosenTemplates: any[] = []
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rand() * templates.length)
    chosenTemplates.push(templates[idx])
  }

  // generate variants (1 per chosen template) — variez un peu toutes les stats
  const variants: any[] = []
  for (let i = 0; i < chosenTemplates.length; i++) {
    const tpl = chosenTemplates[i]
    try {
      const vs = generateVariants(tpl, { count: 1, seed: `${seed}_gen_${i}`, varyAllStats: true, hpScale: 'proportional' })
      if (Array.isArray(vs) && vs.length > 0) variants.push(vs[0])
    } catch (e:any) {
      // fallback simple template mapping
      variants.push({
        instanceId: `mon_fallback_${i}_${Math.random().toString(36).slice(2,8)}`,
        templateId: tpl?.id ?? tpl?.name ?? `tpl_${i}`,
        name: tpl?.name ?? 'Monstre',
        stats: tpl?.stats ?? {},
        hp: { current: tpl?.hp?.max ?? 10, max: tpl?.hp?.max ?? 10 },
        ac: tpl?.ac ?? tpl?.armor_class ?? 10,
        raw: tpl
      })
    }
  }

  // ensure we have a gameId
  const gameId = p.gameId ?? `game_test_${Date.now()}`

  // create encounter
  const enc = await prisma.encounter.create({
    data: {
      gameId,
      round: 0,
      turnOrder: JSON.stringify([]),
      surprise: null,
      state: 'running'
    }
  })

// create characters for each variant and collect DB ids
  const createdChars = []
  for (const v of variants) {
    // Normalisation / sécurité : convertir hp/ac en nombres valides
    // Les templates peuvent avoir hp = number, hp = { max, current }, hp_max, etc.
    let hpMaxRaw: any = undefined
    let hpCurrentRaw: any = undefined

    if (v?.hp && typeof v.hp === 'object') {
      hpMaxRaw = v.hp.max ?? v.hp.hp_max ?? v.hp.maxhp ?? v.hpMax
      hpCurrentRaw = v.hp.current ?? v.hp.hp_current ?? v.hpCurrent
    } else {
      // valeur simple (ex: hp: 12)
      hpMaxRaw = v?.hp ?? v?.hp_max ?? v?.hpMax
    }

    // convert to numbers and provide sane defaults
    let hpMaxNum = Number(hpMaxRaw)
    if (!Number.isFinite(hpMaxNum) || hpMaxNum <= 0) hpMaxNum = 10

    let hpCurrentNum = Number(hpCurrentRaw)
    if (!Number.isFinite(hpCurrentNum) || hpCurrentNum < 0) hpCurrentNum = hpMaxNum

    // AC normalization
    let acNum = Number(v?.ac ?? v?.armor_class ?? 10)
    if (!Number.isFinite(acNum)) acNum = 10

    // For debug: if source had strange values, keep the raw in a field (optional)
    // const rawSource = v?.raw ?? v

    try {
      const created = await prisma.character.create({
        data: {
          gameId,
          kind: 'MONSTRE',
          name: v.name ?? (v.templateId ?? 'Monstre'),
          level: 0,
          hpCurrent: Math.max(0, Math.floor(hpCurrentNum)),
          hpMax: Math.max(1, Math.floor(hpMaxNum)),
          ac: Math.floor(acNum),
          stats: JSON.stringify(v.stats ?? {}),
          inventory: JSON.stringify([])
          // you may add raw: JSON.stringify(rawSource) if you want to inspect templates later
        }
      })
      createdChars.push(created)
    } catch (err:any) {
      // log and continue (avoid total crash) — useful for debugging problematic templates
      // console.error is visible dans la console `pnpm dev`
      console.error('Failed to create character for template', v?.templateId ?? v?.name, err?.message ?? err)
    }
  }

  // compute initiative for created chars (seeded)
  const seedInitHasher = xmur3(`${seed}_init`)
  const randInit = mulberry32(seedInitHasher())
  const actors = createdChars.map(c => {
    let stats = {}
    try { stats = c.stats ? JSON.parse(c.stats) : {} } catch { stats = {} }
    const dex = (stats.dexterity ?? stats.dex ?? 10) as number
    const roll = Math.floor(randInit() * 20) + 1
    const mod = Math.floor((dex - 10) / 2) || 0
    const total = roll + mod
    return { id: c.id, name: c.name, kind: c.kind, hpCurrent: c.hpCurrent, hpMax: c.hpMax, ac: c.ac, stats, initiative: { roll, mod, total } }
  })

  // sort by initiative
  actors.sort((a,b) => b.initiative.total - a.initiative.total || ((b.stats?.dexterity ?? b.stats?.dex ?? 10) - (a.stats?.dexterity ?? a.stats?.dex ?? 10)))

  // persist turnOrder and set roundIndex to 0
  const turnOrder = actors.map(a => a.id)
  await prisma.encounter.update({ where: { id: enc.id }, data: { turnOrder: JSON.stringify(turnOrder), round: 1, roundIndex: 0 } })

  // response
  return {
    ok: true,
    message: 'Test encounter created',
    encounterId: enc.id,
    gameId,
    created: createdChars.length,
    actors,
    turnOrder
  }
})
