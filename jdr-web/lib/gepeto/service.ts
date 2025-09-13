
import type { Command } from '~/lib/schemas/command'

function id(prefix='cmd'): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 8)
}

export function fakeGepeto(message: string, gameId: string): Command[] {
  const m = message.toLowerCase()
  const buy = m.match(/ach[eè]te?\s+(\d+)\s+([a-zéèêàûô'\- ]+)/i)
  if (buy) {
    const qty = parseInt(buy[1], 10)
    const itemName = buy[2].trim().split(' à ')[0].trim().replace(/\s+/g, '_')
    return [{
      id: id(),
      gameId,
      type: 'BUY_ITEM',
      payload: { buyerId: 'pj_1', itemId: `itm_${itemName}`, qty },
      meta: { requiresConfirmation: true, confidence: 0.7 }
    } as Command]
  }

  if (m.includes('quête') || m.includes('prime') || m.includes('bounty')) {
    return [{
      id: id(),
      gameId,
      type: 'CREATE_QUEST',
      payload: { title: 'Chasse à la prime (stub)', importance: 'med', reward: 110 },
      meta: { confidence: 0.6 }
    } as Command]
  }

  if (m.includes('embuscade') || m.includes('attaque surprise')) {
    return [{
      id: id(),
      gameId,
      type: 'COMBAT_SURPRISE_ENEMY',
      payload: { enemies: ['mon_bandit_a','mon_bandit_b','mon_bandit_c'], surprise: 'enemy' },
      meta: { confidence: 0.65 }
    } as Command]
  }

  return [{
    id: id(),
    gameId,
    type: 'CREATE_QUEST',
    payload: { title: 'TODO: interprétation (S0 stub)', importance: 'low' },
    meta: { confidence: 0.2, requiresConfirmation: false }
  } as Command]
}
