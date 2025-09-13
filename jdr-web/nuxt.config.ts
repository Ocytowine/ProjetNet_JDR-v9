
export default defineNuxtConfig({
  devtools: { enabled: true },
  typescript: { strict: true, typeCheck: false },
  modules: ['@pinia/nuxt'],
  css: ['~/assets/tailwind.css'],
  runtimeConfig: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    useFakeAi: process.env.USE_FAKE_AI || 'true',
    databaseUrl: process.env.DATABASE_URL || 'file:./dev.db'
  }
})
