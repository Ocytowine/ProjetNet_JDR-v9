// server/api/encounter/advance.post.ts
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import fetch from 'node-fetch'

const prisma = new PrismaClient()

const bodySchema = z.object({
  encounterId: z.string().min(1),
  autoRunAI: z.boolean().optional().default(true) // si true, server exécutera PNJ moves
})

/* resolveAction simple: supports 'attack' and 'end_turn' for now */
async function resolveAction(action, actor, characters) {
  if (action.type === 'end_turn') {
    return { log: `${actor.name} ends their turn.` }
  }
  if (action.type === 'attack') {
    const target = characters.find(c => c.id === action.targetId)
    if (!target) return { error: 'target not found' }
    // simple attack resolution: roll d20 + strMod vs AC
    const str = (actor.stats?.strength ?? 10)
    const strMod = Math.floor((str - 10) / 2)
    const atkRoll = Math.floor(Math.random()*20)+1
    const total = atkRoll + (action.params?.atkMod ?? strMod)
    const hit = total >= (target.ac ?? 10)
    let damage = 0
    if (hit) {
      const dmgDie = action.params?.dmgDie ?? 8
      damage = Math.max(1, Math.floor(Math.random()*dmgDie)+ (Math.floor((str-10)/2)))
      // apply damage
      await prisma.character.update({ where: { id: target.id }, data: { hpCurrent: Math.max(0, target.hpCurrent - damage) } })
    }
    return { log: `${actor.name} attacks ${target.name} (roll ${atkRoll}+${strMod} => ${total}) ${hit?`hits for ${damage}`:'missed'}`, hit, damage, targetId: target.id }
  }
  return { error: 'unsupported action' }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const p = bodySchema.parse(body)

  const enc = await prisma.encounter.findUnique({ where: { id: p.encounterId } })
  if (!enc) return createError({ statusCode: 404, statusMessage: 'Encounter not found' })

  const turnOrder = JSON.parse(enc.turnOrder || '[]') as string[]
  if (turnOrder.length === 0) return createError({ statusCode: 400, statusMessage: 'Empty turn order' })

  // maintain a currentIndex in encounter (we used round previously; store pointer)
  const currentIndex = Number(enc.roundIndex ?? 0) // si pas présent, 0
  const nextIndex = (currentIndex) % turnOrder.length
  const actorId = turnOrder[nextIndex]

  const actor = await prisma.character.findUnique({ where: { id: actorId } })
  if (!actor) return createError({ statusCode: 404, statusMessage: 'Actor not found' })

  // fetch all characters for decisions
  const characters = await prisma.character.findMany({ where: { gameId: enc.gameId } })
  // parse stats
  characters.forEach(c => { try { c.stats = JSON.parse(c.stats || '{}') } catch(e){ c.stats = {} } })

  // if actor is player -> return options
  if (actor.kind === 'PJ' || actor.kind === 'PLAYER') {
    return { ok: true, mode: 'player_turn', actor: { id: actor.id, name: actor.name, hpCurrent: actor.hpCurrent }, optionsEndpoint: `/api/encounter/options?encounterId=${enc.id}&actorId=${actor.id}` }
  }

  // else actor is NPC -> ask AI to decide and execute
  if (actor.kind === 'MONSTRE' || actor.kind === 'NPC') {
    // call decide endpoint (internal)
    const decideResp = await $fetch('/api/encounter/decide', { method: 'POST', body: { encounterId: enc.id, actorInstanceId: actor.id } })
    if (!decideResp?.ok) return createError({ statusCode: 500, statusMessage: 'AI decide failed', data: decideResp })

    const aiAction = decideResp.ai?.action
    // execute action
    const result = await resolveAction(aiAction, { id: actor.id, name: actor.name, stats: JSON.parse(actor.stats || '{}') }, characters)
    // advance index
    const newIndex = (currentIndex + 1) % turnOrder.length
    await prisma.encounter.update({ where: { id: enc.id }, data: { roundIndex: newIndex } })
    // return result and new state
    const updatedChars = await prisma.character.findMany({ where: { gameId: enc.gameId } })
    return { ok: true, mode: 'npc_executed', actionResult: result, actors: updatedChars }
  }

  return createError({ statusCode: 400, statusMessage: 'Unknown actor kind' })
})
