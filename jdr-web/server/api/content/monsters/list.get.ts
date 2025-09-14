/* server/api/content/monsters.list.get.ts
   Retourne une liste compacte { id, name } pour les templates de monstres
*/
import { getMonsters } from '~/lib/content/remoteProvider'

export default defineEventHandler(async (event) => {
  try {
    const monsters = await getMonsters()
    let list: Array<{ id: string; name: string }> = []

    if (Array.isArray(monsters)) {
      list = monsters.map((m: any) => ({
        id: m.id ?? (m.name ? String(m.name).toLowerCase().replace(/\s+/g, '_') : ''),
        name: m.name ?? ''
      }))
    } else if (monsters && typeof monsters === 'object') {
      list = Object.entries(monsters).map(([k, v]: any) => ({
        id: k,
        name: (v && (v as any).name) ? (v as any).name : ''
      }))
    }

    return { ok: true, count: list.length, list }
  } catch (e: any) {
    return createError({ statusCode: 500, statusMessage: e.message })
  }
})
