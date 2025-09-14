// lib/content/remoteProvider.ts
// Remote-first content provider: always fetch from raw.githubusercontent + cache (memory + .cache)
// Usage: import { getMonsters, getItems, getSpells, getClasses, getSubclasses } from '~/lib/content/remoteProvider'

import fs from 'fs/promises'
import path from 'path'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/Ocytowine/ArchiveValmorin/main'
const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'content')
const DEFAULT_TTL_MS = Number(process.env.CONTENT_CACHE_TTL_MS || 10 * 60 * 1000) // default 10 min

type CacheEntry = { ts: number; data: any }
const memoryCache = new Map<string, CacheEntry>()

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true }).catch(()=>{})
}

async function readCacheFile(key: string): Promise<CacheEntry|null> {
  try {
    const p = path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`)
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed as CacheEntry
  } catch (e) {
    return null
  }
}

async function writeCacheFile(key: string, data: any) {
  try {
    await ensureCacheDir()
    const p = path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`)
    const entry: CacheEntry = { ts: Date.now(), data }
    await fs.writeFile(p, JSON.stringify(entry), 'utf-8')
  } catch (e) {
    // best-effort
  }
}

async function fetchJsonRemote(relPath: string, timeoutMs = 15000): Promise<any> {
  const url = `${GITHUB_RAW_BASE}/${relPath}`
  // prefer global fetch (Node 18+ / runtime). Use fetch with timeout.
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(()=>controller.abort(), timeoutMs) : null
  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
    const json = await res.json()
    return json
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Core loader:
 * - always tries memory cache if TTL ok
 * - then disk cache if TTL ok
 * - otherwise fetch remote, update caches
 */
async function loadRemoteWithCache(relPath: string, ttl = DEFAULT_TTL_MS, forceRefresh=false) {
  const key = relPath
  const mem = memoryCache.get(key)
  if (!forceRefresh && mem && (Date.now() - mem.ts) < ttl) return mem.data

  // disk cache
  const disk = await readCacheFile(key)
  if (!forceRefresh && disk && (Date.now() - disk.ts) < ttl) {
    memoryCache.set(key, { ts: disk.ts, data: disk.data })
    return disk.data
  }

  // fetch remote
  const data = await fetchJsonRemote(relPath)
  memoryCache.set(key, { ts: Date.now(), data })
  writeCacheFile(key, data).catch(()=>{})
  return data
}

/* ---------- Public API ---------- */
// Note: forceRefresh optional param to bypass cache
export async function getMonsters(opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  return loadRemoteWithCache('Monsters.json', opts?.ttlMs ?? DEFAULT_TTL_MS, !!opts?.forceRefresh)
}
export async function getItems(opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  // item filename in repo: items.json
  return loadRemoteWithCache('items.json', opts?.ttlMs ?? DEFAULT_TTL_MS, !!opts?.forceRefresh)
}
export async function getSpells(opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  return loadRemoteWithCache('spells.json', opts?.ttlMs ?? DEFAULT_TTL_MS, !!opts?.forceRefresh)
}
export async function getClasses(opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  // repo might use folder 'Classes' or file - try common names
  const candidates = ['Classes.json', 'classes.json', 'Classes/index.json', 'Classes/Classes.json']
  for (const c of candidates) {
    try {
      const r = await loadRemoteWithCache(c, opts?.ttlMs ?? DEFAULT_TTL_MS, !!opts?.forceRefresh)
      if (r) return r
    } catch (e) { /* try next */ }
  }
  // fallback: try directory listing not supported via raw.githubusercontent - fail gracefully
  throw new Error('Classes not found in remote repo (checked common filenames)')
}
export async function getSubclasses(opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  return loadRemoteWithCache('subclasses.json', opts?.ttlMs ?? DEFAULT_TTL_MS, !!opts?.forceRefresh)
}

/** helper find by id or name (items) */
export async function findItemById(idOrName: string, opts?: { ttlMs?: number, forceRefresh?: boolean }) {
  const items = await getItems(opts)
  if (!items) return null
  if (Array.isArray(items)) return items.find((i:any)=>i.id===idOrName || i.name===idOrName || (i.slug && i.slug===idOrName))
  if (typeof items==='object') return items[idOrName] ?? Object.values(items).find((v:any)=>v.name===idOrName)
  return null
}

/* small util: clear memory cache (dev) */
export function clearMemoryCache(key?: string) {
  if (!key) memoryCache.clear()
  else memoryCache.delete(key)
}
