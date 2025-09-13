
import { z } from 'zod'
import { commandSchema } from '~/lib/schemas/command'
import { fakeGepeto } from '~/lib/gepeto/service'

const bodySchema = z.object({
  message: z.string().min(1),
  gameId: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const runtime = useRuntimeConfig()
  const body = await readBody(event)
  const { message, gameId } = bodySchema.parse(body)

  const useFake = String(runtime.useFakeAi).toLowerCase() !== 'false'
  if (useFake) {
    const cmds = fakeGepeto(message, gameId)
    const parsed = cmds.map(c => commandSchema.parse(c))
    return { ok: true, commands: parsed }
  }

  return { ok: false, error: 'Mode GPT non activé dans S0' }
})
