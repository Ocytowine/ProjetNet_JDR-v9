
# JDR Web — S0 Bootstrap

🧭 Objectif: squelette 100% local et gratuit.

## Prérequis
- Node.js LTS (18+)
- pnpm (`npm i -g pnpm`)

## Installation
```bash
pnpm install
pnpm prisma:gen
pnpm db:push
pnpm dev
```

## Modes IA
- Gratuit: `USE_FAKE_AI=true` (par défaut)
- Réel: `OPENAI_API_KEY=...` + `USE_FAKE_AI=false` (à brancher plus tard)

## Structure
- Pages: `/` (Accueil), `/wizard`, `/aventure`
- API: `/server/api/intent.post.ts` (faux Gépéto), `/server/api/command.post.ts`, `/server/api/events.get.ts`
- Schémas: `lib/schemas/command.ts`
- Prisma (SQLite): `prisma/schema.prisma`
