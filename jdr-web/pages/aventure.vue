
<script setup lang="ts">
import ChatPanel from '@/components/ChatPanel.vue'
import { useGameStore } from '@/stores/game'
const game = useGameStore()
if (!game.gameId) game.newGame()
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-4 p-4 max-w-7xl mx-auto">
    <section class="lg:col-span-2">
      <ChatPanel />
    </section>
    <aside class="space-y-4">
      <div class="rounded-2xl border bg-white p-4">
        <h2 class="font-semibold">Onglets</h2>
        <ul class="mt-2 list-disc list-inside text-sm text-gray-600">
          <li>Fiche (lecture seule)</li>
          <li>Journal (Caboche)</li>
          <li>Carte (plus tard)</li>
        </ul>
      </div>
      <div class="rounded-2xl border bg-white p-4">
        <h2 class="font-semibold">Quêtes</h2>
        <p class="text-sm text-gray-600">À venir: liste, importance, récompenses.</p>
      </div>
    </aside>
  </div>
</template>
