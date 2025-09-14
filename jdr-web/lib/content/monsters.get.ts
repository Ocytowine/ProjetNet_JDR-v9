// server/api/content/monsters.get.ts
import { getMonsters } from '~/lib/content/remoteProvider'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const force = q.force === '1' || q.force === 'true'
  try {
    const data = await getMonsters({ forceRefresh: !!force })
    return { ok: true, count: Array.isArray(data) ? data.length : Object.keys(data).length, data }
  } catch (e:any) {
    return createError({ statusCode: 500, statusMessage: e.message })
  }
})
