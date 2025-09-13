
import { defineStore } from 'pinia'

function makeId(prefix='g') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8)
}

export const useGameStore = defineStore('game', {
  state: () => ({
    gameId: '' as string
  }),
  actions: {
    newGame() {
      this.gameId = makeId('g')
      if (process.client) localStorage.setItem('gameId', this.gameId)
    },
    load() {
      if (process.client) this.gameId = localStorage.getItem('gameId') || ''
    }
  }
})
