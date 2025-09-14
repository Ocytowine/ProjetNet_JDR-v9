// lib/expand/monsterExpander.ts
// Utilise la source remote (raw.githubusercontent.com) et génère N variantes d'un template.
// Pas d'UI — serveur only. Dépendance: none (Node 18+ fetch)

import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/Ocytowine/ArchiveValmorin/main'
const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'content')
const DEFAULT_TTL_MS = Number(process.env.CONTENT_CACHE_TTL_MS || 10 * 60 * 1000)

type MonsterTemplate = any
type ExpandedMonster = {
  instanceId: string
  templateId?: string
  name: string
  stats: Record<string, number>
  hp: { current: number; max: number }
  ac?: number
  abilities?: any
  raw?: any
}

// petit RNG deterministe par seed (xmur3 + mulberry32)
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

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true }).catch(()=>{})
}
async function readDiskCache(key: string) {
  try {
    const p = path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`)
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed
  } catch (e) { return null }
}
async function writeDiskCache(key: string, data: any) {
  try {
    await ensureCacheDir()
    const p = path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`)
    await fs.writeFile(p, JSON.stringify({ ts: Date.now(), data }), 'utf-8')
  } catch (e) {}
}

const memoryCache = new Map<string, { ts:number, data:any }>()

async function fetchRemoteJSON(relPath: string, ttl = DEFAULT_TTL_MS, force = false) {
  const key = relPath
  const mem = memoryCache.get(key)
  if (!force && mem && Date.now() - mem.ts < ttl) return mem.data
  const disk = await readDiskCache(key)
  if (!force && disk && Date.now() - disk.ts < ttl) {
    memoryCache.set(key, { ts: disk.ts, data: disk.data })
    return disk.data
  }
  const url = `${GITHUB_RAW_BASE}/${relPath}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status}`)
  const json = await res.json()
  memoryCache.set(key, { ts: Date.now(), data: json })
  writeDiskCache(key, json).catch(()=>{})
  return json
}

/**
 * findTemplate(templateId) :
 * - cherche dans Monsters.json (par id ou nom),
 * - si non trouvé lève une erreur.
 */
export async function findTemplate(templateId: string) {
  const monsters = await fetchRemoteJSON('Monsters.json')
  // dépend du format : essaye array then object map
  if (Array.isArray(monsters)) {
    return monsters.find((m:any) => m.id === templateId || m.name?.toLowerCase() === templateId.toLowerCase())
  } else if (typeof monsters === 'object') {
    return monsters[templateId] ?? Object.values(monsters).find((m:any)=>m.name?.toLowerCase()===templateId.toLowerCase())
  }
  return null
}

/**
 * generateVariants(template, opts)
 * opts:
 *  - count: number (>=1)
 *  - seed?: string (optional, pour reproducibility)
 *  - statModifiers?: { key: string, min: number, max: number }[]  => for each variant, apply random int in [min,max]
 *  - varyAllStats?: boolean (if true, apply small random to all main stats)
 *  - hpScale?: number (e.g. 1.0 default) or 'proportional' to stat change
 */
export function generateVariants(template: MonsterTemplate, opts: {
  count: number,
  seed?: string,
  statModifiers?: Array<{ key: string, min: number, max: number }>,
  varyAllStats?: boolean,
  hpScale?: number|'proportional'
}): ExpandedMonster[] {
  const seed = opts.seed ?? crypto.randomUUID()
  const hasher = xmur3(seed)
  const rng = mulberry32(hasher())

  const baseStats: Record<string, number> = (template?.stats) ? {...template.stats} : {}
  const baseHP = template?.hp ?? (template?.hp_max ? { current: template.hp_max, max: template.hp_max } : { current: 10, max: 10 })
  const baseAC = template?.ac ?? template?.armor_class ?? undefined

  const out: ExpandedMonster[] = []
  for (let i=0;i<opts.count;i++) {
    // instance-specific RNG: mix seed with index
    const instanceSeed = `${seed}_${i}`
    const ih = xmur3(instanceSeed)()
    const irng = mulberry32(ih)

    // clone stats
    const stats = {...baseStats}
    if (opts.varyAllStats) {
      for (const k of Object.keys(stats)) {
        const delta = Math.floor((irng() * 3) - 1) // -1..+1 small
        stats[k] = Math.max(1, (stats[k] ?? 10) + delta)
      }
    }
    if (Array.isArray(opts.statModifiers)) {
      for (const mod of opts.statModifiers) {
        const delta = Math.floor(irng() * (mod.max - mod.min + 1)) + mod.min
        stats[mod.key] = Math.max(1, (stats[mod.key] ?? 10) + delta)
      }
    }

    // hp scaling: simple proportional to avg stat change if 'proportional'
    let hpMax = baseHP.max ?? baseHP
    if (opts.hpScale === 'proportional') {
      const baseAvg = average(Object.values(baseStats))
      const newAvg = average(Object.values(stats))
      const factor = baseAvg > 0 ? (newAvg / baseAvg) : 1
      hpMax = Math.max(1, Math.round((baseHP.max ?? baseHP) * factor))
    } else if (typeof opts.hpScale === 'number') {
      hpMax = Math.max(1, Math.round((baseHP.max ?? baseHP) * opts.hpScale))
    }

    const instance: ExpandedMonster = {
      instanceId: `mon_${crypto.randomUUID().slice(0,8)}`,
      templateId: template?.id ?? template?.name,
      name: template?.name ?? ('Monstre'),
      stats,
      hp: { current: hpMax, max: hpMax },
      ac: baseAC,
      abilities: template?.abilities ?? template?.actions ?? undefined,
      raw: template
    }
    out.push(instance)
  }
  return out
}

function average(arr: number[]|undefined) {
  if (!arr || arr.length===0) return 0
  return arr.reduce((a,b)=>a+b,0)/arr.length
}
