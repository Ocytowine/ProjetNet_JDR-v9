
<script setup lang="ts">
import { useGameStore } from '@/stores/game'
const game = useGameStore()
if (!game.gameId) game.newGame()
</script>

<template>
  <main class="mx-auto max-w-3xl p-6 space-y-4">
    <h1 class="text-2xl font-bold">Création de personnage (Bonome v0)</h1>
    <p class="text-sm text-gray-600">WIP — Choisis quelques paramètres simples et enregistre.</p>

    <form class="space-y-3" @submit.prevent="">
      <div>
        <label class="block text-sm font-medium">Nom</label>
        <input class="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Elya, Korr, ..." />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium">Classe</label>
          <select class="mt-1 w-full rounded-xl border px-3 py-2">
            <option>Guerrier</option>
            <option>Magicien</option>
            <option>Roublard</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium">Niveau</label>
          <input type="number" min="1" value="1" class="mt-1 w-full rounded-xl border px-3 py-2" />
        </div>
      </div>
      <NuxtLink to="/aventure" class="inline-flex items-center px-4 py-2 rounded-xl bg-black text-white">Aller à l'aventure</NuxtLink>
    </form>
  </main>
</template>
