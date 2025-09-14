// server/api/encounter/options.get.ts
import { z } from 'zod'
import { getMonsters } from '~/lib/content/remoteProvider'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const encounterId = q.encounterId as string
  const actorId = q.actorId as string
  if (!encounterId || !actorId) return createError({ statusCode:400, statusMessage: 'missing' })

  const actor = await prisma.character.findUnique({ where: { id: actorId } })
  if (!actor) return createError({ statusCode:404, statusMessage: 'actor' })

  // simple options generation: attack, move, cast (if spells), use item (if inventory not empty), end_turn
  const stats = (() => { try { return JSON.parse(actor.stats || '{}') } catch { return {} } })()
  const inventory = (() => { try { return JSON.parse(actor.inventory || '[]') } catch { return [] } })()

  const options = [
    { id: 'attack', label: 'Attaquer (Mêlée / Distance selon arme)' },
    { id: 'move', label: 'Se déplacer' },
  ]
  if (inventory.length > 0) options.push({ id: 'use_item', label: 'Utiliser un objet' })
  // simple spell detection placeholder
  const spells = [] // tu peux remplir via spells expand selon class
  if (spells.length > 0) options.push({ id: 'cast', label: 'Lancer un sort' })
  options.push({ id: 'end_turn', label: 'Terminer le tour' })

  return { ok: true, actor: { id: actor.id, name: actor.name, hpCurrent: actor.hpCurrent, hpMax: actor.hpMax, stats }, options }
})
