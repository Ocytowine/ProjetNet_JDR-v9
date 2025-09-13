
import { z } from 'zod'
import { commandSchema } from '~/lib/schemas/command'

export default defineEventHandler(async (event) => {
  const cmd = commandSchema.parse(await readBody(event))
  return { ok: true, accepted: cmd.type }
})
