// server/api/encounter/decide.post.ts
// Appelle l'API OpenAI pour décider l'action d'un PNJ dans un encounter.
// Renvoie un JSON validé { action, explanation, confidence } ou une action fallback (end_turn).
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const bodySchema = z.object({
  encounterId: z.string().min(1),
  actorInstanceId: z.string().min(1),
  context: z.any().optional()
})

// Schéma attendu de la réponse AI (validation stricte)
const aiActionSchema = z.object({
  type: z.enum(['attack', 'move', 'cast', 'use_item', 'special', 'end_turn']),
  targetId: z.string().nullable().optional(),
  params: z.record(z.any()).optional()
})
const aiResponseSchema = z.object({
  action: aiActionSchema,
  explanation: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

function extractFirstJSON(s: string): string | null {
  // tente d'extraire le premier objet JSON trouvé dans la réponse (supporte éventuels ```json ``` fences)
  if (!s) return null
  // remove code fences
  s = s.replace(/```json|```/gi, '')
  // find first { ... } balanced
  let start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  let params
  try {
    params = bodySchema.parse(body)
  } catch (err: any) {
    return createError({ statusCode: 400, statusMessage: 'Invalid request', data: err.errors || err.message })
  }

  // load encounter + actor + scene
  const enc = await prisma.encounter.findUnique({ where: { id: params.encounterId } })
  if (!enc) return createError({ statusCode: 404, statusMessage: 'Encounter not found' })

  const actor = await prisma.character.findUnique({ where: { id: params.actorInstanceId } })
  if (!actor) return createError({ statusCode: 404, statusMessage: 'Actor not found' })

  const characters = await prisma.character.findMany({ where: { gameId: enc.gameId } })

  // build minimized scene (limit size)
  const scene = characters.slice(0, 60).map(c => {
    let stats = {}
    try { stats = c.stats ? JSON.parse(c.stats) : {} } catch { stats = {} }
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      hpCurrent: c.hpCurrent,
      hpMax: c.hpMax,
      ac: c.ac,
      stats
    }
  })

  const actorMini = scene.find(s => s.id === actor.id) ?? {
    id: actor.id, name: actor.name, kind: actor.kind, hpCurrent: actor.hpCurrent, hpMax: actor.hpMax, ac: actor.ac, stats: {}
  }

  // Build system + user prompts (clear instruction to return JSON ONLY)
  const systemPrompt = `
You are a TTRPG combat decision engine. You will receive a compact "scene" (list of actors) and "actor" (the controlled actor).
Return ONLY a single JSON object (no markdown, no extra text) that validates to the schema:
{
  "action": {
    "type": "attack" | "move" | "cast" | "use_item" | "special" | "end_turn",
    "targetId": "<actor id or null>",
    "params": { ... optional params: dmgDie, atkMod, distance, spellName, etc. }
  },
  "explanation": "short (1-2 sentences) explanation of the choice",
  "confidence": 0.0-1.0
}
Prefer simple, safe actions. If uncertain, choose { action: { type: "end_turn" } }.
Use actor's stats (like strength/dexterity/con) and target AC/hp to decide. Keep output concise and machine-parseable.
`

  const userPayload = {
    scene,
    actor: actorMini,
    encounter: {
      id: enc.id,
      turnOrder: (() => {
        try { return JSON.parse(enc.turnOrder || '[]') } catch { return [] }
      })()
    },
    context: params.context || {}
  }

  // call OpenAI (or other LLM) via REST. Model name configurable via env.
  const OPENAI_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_KEY) return createError({ statusCode: 500, statusMessage: 'OpenAI API key not configured' })

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini' // adapt as you have access

  let aiText = ''
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) }
        ],
        max_tokens: 400,
        temperature: 0.15,
        n: 1
      }),
      // a reasonable timeout is controlled by environment / runtime; H3 readBody handles server timeouts
    })

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return createError({ statusCode: 502, statusMessage: 'OpenAI error', data: txt })
    }

    const j = await resp.json().catch(() => null)
    aiText = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? ''
  } catch (err: any) {
    return createError({ statusCode: 502, statusMessage: 'Failed to contact OpenAI', data: err.message })
  }

  // extract JSON from aiText and validate
  let parsed: any = null
  try {
    const candidate = extractFirstJSON(aiText) ?? aiText
    parsed = candidate ? JSON.parse(candidate) : null
  } catch {
    parsed = null
  }

  // Validate against aiResponseSchema
  let validated = null
  try {
    validated = aiResponseSchema.parse(parsed)
  } catch (err) {
    // fallback: create a safe end_turn action
    const fallback = { action: { type: 'end_turn' }, explanation: 'AI returned invalid response; fallback to end_turn', confidence: 0.0 }
    return { ok: true, ai: fallback, raw: aiText, warning: 'AI response invalid, used fallback' }
  }

  // Final safety checks: ensure targetId exists if provided
  if (validated.action?.targetId) {
    const found = scene.find(s => s.id === validated.action.targetId)
    if (!found) {
      // invalid target -> fallback to end_turn
      const fallback = { action: { type: 'end_turn' }, explanation: 'AI chose invalid target; fallback to end_turn', confidence: 0.0 }
      return { ok: true, ai: fallback, raw: aiText, warning: 'AI target invalid, used fallback' }
    }
  }

  // success
  return { ok: true, ai: validated, raw: aiText }
})
