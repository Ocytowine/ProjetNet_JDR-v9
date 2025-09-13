
export default defineEventHandler(async () => {
  return [
    { type: 'ENCOUNTER_STARTED', payload: { encounterId: 'enc_1', surprise: 'enemy' } },
    { type: 'INITIATIVE_ROLLED', payload: { order: ['mon_a','pj_1','mon_b'] } }
  ]
})
