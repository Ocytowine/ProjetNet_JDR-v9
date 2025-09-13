
<script setup lang="ts">
import { ref } from 'vue'
import { useGameStore } from '@/stores/game'
const storyInput = ref('')
const metaInput = ref('')
const loading = ref(false)
const messages = ref<{ role: 'user'|'assistant', text: string }[]>([
  { role: 'assistant', text: 'Bienvenue ! Raconte ce que tu fais, je m’occupe d’interpréter.' }
])
const game = useGameStore()

async function send(kind: 'story'|'meta') {
  const text = kind === 'story' ? storyInput.value : metaInput.value
  if (!text.trim()) return
  messages.value.push({ role: 'user', text })
  kind === 'story' ? (storyInput.value='') : (metaInput.value='')
  loading.value = true
  try {
    const { data } = await useFetch('/api/intent', {
      method: 'POST',
      body: { message: text, gameId: game.gameId }
    })
    messages.value.push({ role: 'assistant', text: JSON.stringify(data.value, null, 2) })
  } catch (e:any) {
    messages.value.push({ role: 'assistant', text: 'Erreur: '+(e?.message||'inconnue') })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rounded-2xl border bg-white p-4 space-y-4">
    <h2 class="font-semibold">Fenêtre de discussion</h2>
    <div class="h-80 overflow-auto rounded-xl border p-3 bg-gray-50 text-sm whitespace-pre-wrap">
      <div v-for="(m,i) in messages" :key="i" class="mb-2">
        <span class="font-semibold" :class="m.role==='assistant' ? 'text-indigo-600' : 'text-gray-800'">
          {{ m.role === 'assistant' ? 'MJ IA' : 'Toi' }}:
        </span>
        <span class="ml-2">{{ m.text }}</span>
      </div>
    </div>
    <div class="grid md:grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium">Écrire dans l'histoire</label>
        <div class="mt-1 flex gap-2">
          <input v-model="storyInput" class="flex-1 rounded-xl border px-3 py-2" placeholder="Je traverse la taverne et..." />
          <button @click="send('story')" class="px-3 py-2 rounded-xl bg-black text-white" :disabled="loading">Envoyer</button>
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium">Écrire au MJ</label>
        <div class="mt-1 flex gap-2">
          <input v-model="metaInput" class="flex-1 rounded-xl border px-3 py-2" placeholder="Hors RP: pourrais-tu détailler..." />
          <button @click="send('meta')" class="px-3 py-2 rounded-xl bg-white border" :disabled="loading">Envoyer</button>
        </div>
      </div>
    </div>
  </div>
</template>
