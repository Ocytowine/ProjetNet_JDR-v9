# JDR base à zéro — Architecture v0.1 (proposition)

## 0) Objectif
Créer un site web (Vue) pour jouer à un JDR solo/coop avec un « MJ IA ». MVP =
- Page d’accueil → démarrage d’une nouvelle partie (ouvre l’assistant de création de PJ).
- Wizard de création du PJ (Module_Bonome minimal).
- Page Aventure avec :
  - Fenêtre de discussion principale (joueur ↔️ MJ IA)
  - Deux champs d’envoi ("dans l’histoire" et "au MJ")
  - Onglets *Fiche* (lecture seule), *Journal* (Caboche), *Carte* (placeholder)
- Interpréteur d’intentions (Module_Gépéto) qui transforme la narration en **Commandes** (ex: `BUY_ITEM`, `CREATE_QUEST`, `COMBAT_SURPRISE_ENEMY`) ; confirmation popup si nécessaire.
- Boucle de combat minimale (Module_Castagne) : surprise, initiative, choix d’attaque, fenêtre de réaction.
- Mémoire journalière (Module_Caboche) qui résume et structure les faits clefs (journal, quêtes, relations, visites, chapitrage de contexte récent).

---

## 1) Pile technique (proposée)
**Front** : Nuxt 3 (Vue 3 + Vite) • TypeScript • Pinia (state) • Tailwind • Headless UI.

**Back** : Nuxt Server Routes (Nitro) pour commencer (un seul repo). Évolution possible vers NestJS si besoin de services séparés.

**Base de données** : SQLite (dev) → Postgres (prod). ORM : Prisma. Éventuellement Supabase en hébergement.

**Temps réel** : Socket.IO (parties multi‑onglets / futures coop). MVP peut rester en HTTP.

**Auth/Session** : anonyme + `gameId` stocké ; plus tard email/OAuth.

**LLM** : API GPT via un service serveur (`/api/intent`) avec *function calling* (ou schéma JSON contraint) pour produire des `Command`.

**Tests** : Vitest (front & shared) + Playwright (E2E).

**Infra** : Monorepo pnpm (apps: `web`, `server` intégré) ; CI simple (lint, build, tests).

---

## 2) Architecture logique (DDD léger)
- **Module_Gépéto (Orchestrateur d’intentions)** : interprète la narration, émet des **Commandes** typées avec métadonnées (confiance, besoin de validation, références au contexte).
- **Module_Castagne (Moteur de combat)** : applique les commandes d’action (mouvement, attaque, sorts, réactions), gère surprise/initiative/réactions et journalise les **Événements**.
- **Module_Caboche (Mémoire & Journal)** : agrège les événements du jour, écrit le journal, met à jour quêtes/relations/visites, produit un *focus window* (mémoire courte) et archive l’ancien.
- **Module_Bonome (Création & fiches)** : wizard PJ + génération PNJC ; calculs auto (compétences/CA/bonus) ; intégration classes/sous‑classes/sorts.
- **Module_Dodo (Repos & besoins)** : valide le repos (court/long), gère péripéties, récupération de ressources, faim/soif/sommeil.
- **Outils partagés** : `dice_helper`, `rules`, `monstre_expand`, `spells_expand`, `theater_construct`.
- **Noyau** : `CommandBus`, `EventStore`, `GameState` (projections), `IdFactory`.

**Pattern global** : *Intent → Command → Validation/Preview → Reaction Window → Commit → Events → Projections (state & journal) → Mémoire (Caboche).*

---

## 3) Flux (texte séquentiel)
1. Joueur écrit → `POST /api/intent` → Gépéto produit `Command[]` (avec `requiresConfirmation?: boolean`).
2. Si confirmation requise → UI popup → `CONFIRM_COMMAND` → `CommandBus.dispatch()`.
3. `CommandBus` délègue au module propriétaire (Castagne/Bonome/Caboche/Dodo).
4. **Preview** (simulation) + **Fenêtre de réactions** : `collectReactionCandidates` puis `resolveReactionsWindow` (cf. § Castagne).
5. **Commit** séquentiel avec sauvegardes snapshot + écriture `Event`(s) dans `EventStore`.
6. Projections mises à jour (fiche, combat, quêtes, journal).
7. Caboche digest (synchrone ou en tâche « fin de journée » déclenchée par `DAY_TICK`).

---

## 4) Schémas (TypeScript, contrats partagés)
### 4.1 Identités
- `pj_*`, `pnjc_*`, `pnj_*`, `mon_*`, `cmp_*` (compagnons), `enc_*` (encounter), `q_*` (quest), `loc_*` …

### 4.2 Command (générique)
```ts
type CommandBase = {
  id: string;               // uuid
  gameId: string;
  actorId?: string;         // quand applicable
  type: string;             // ex: "BUY_ITEM"
  payload: unknown;         // détaillé par sous-type
  meta?: { confidence?: number; requiresConfirmation?: boolean; sourceMsgId?: string };
};
```

**Exemples**
```ts
// Achat
interface CmdBuyItem extends CommandBase { type: "BUY_ITEM"; payload: { buyerId: string; itemId: string; qty: number; price?: number; vendorId?: string } }

// Quête
interface CmdCreateQuest extends CommandBase { type: "CREATE_QUEST"; payload: { title: string; description?: string; reward?: string | number; importance: "low"|"med"|"high"; tags?: string[] } }

// Combat (embuscade ennemie)
interface CmdCombatSurpriseEnemy extends CommandBase { type: "COMBAT_SURPRISE_ENEMY"; payload: { locationId?: string; enemies: string[]; surprise: "enemy"; } }
```

### 4.3 Event (journalisé)
```ts
type EventBase = { id: string; gameId: string; type: string; payload: unknown; createdAt: string; causedBy: string /*commandId*/ };
```
**Exemples** : `ITEM_PURCHASED`, `QUEST_CREATED`, `ENCOUNTER_STARTED`, `INITIATIVE_ROLLED`, `ATTACK_RESOLVED`, `DAMAGE_APPLIED`, `REACTION_TRIGGERED`, `REST_STARTED`, `REST_INTERRUPTED`, `DAY_TICKED`, `MEMORY_SUMMARY_WRITTEN`…

### 4.4 Entités clés (extraits)
```ts
interface CharacterBase { id: string; name: string; type: "PJ"|"PNJC"|"PNJ"|"MONSTRE"; level?: number; hp: { current: number; max: number }; ac?: number; stats: Record<string, number>; inventory: ItemStack[]; conditions?: string[] }
interface PlayerCharacter extends CharacterBase { type: "PJ"; class: string; subclass?: string; background?: string; skills: Record<string, number>; spells?: SpellRef[] }
interface Quest { id: string; title: string; status: "open"|"active"|"done"|"failed"; importance: "low"|"med"|"high"; reward?: string|number; notes?: string[] }
interface Relationship { npcId: string; score: number; lastSeenDay?: number; summary?: string }
interface Visit { locationId: string; day: number; summary?: string }
interface Encounter { id: string; participants: string[]; round: number; turnOrder: string[]; surprise?: "enemy"|"party"|null; state: "idle"|"running"|"ended" }
```

---

## 5) Module_Gépéto — contrat & DSL
**Entrée** : message naturel + contexte (state condensé, *focus window* Caboche).

**Sortie** : `Command[]` JSON **valides** contre zod/schéma. Chaque commande : `requiresConfirmation?` selon criticité (ex. dépenses).

**Règles** :
- Intentions *achat/quête/combat/repos/mouvement/sorts* détectées par *few-shot* + schéma.
- Pas de mutation directe : toujours via `CommandBus`.
- Ajout d’`explanations[]` (pour debogage) non persistées.

**Exemples (payloads Gépéto)**
```json
{"type":"BUY_ITEM","payload":{"buyerId":"pj_1","itemId":"itm_ration","qty":2,"price":5},"meta":{"requiresConfirmation":true}}
```
```json
{"type":"CREATE_QUEST","payload":{"title":"Chasse à la prime : Rôdeurs des collines","importance":"med","reward":110}}
```
```json
{"type":"COMBAT_SURPRISE_ENEMY","payload":{"enemies":["mon_bandit_a","mon_bandit_b","mon_bandit_c"],"surprise":"enemy"}}
```

---

## 6) Module_Castagne — runtime de combat
**Sources** : Intègre le déroulé et garde‑fous enregistrés.

**Pipeline tour par tour**
1) **Pré‑rolls optionnels** pour cohérence preview→commit.
2) **Fenêtre de réactions** : `collectReactionCandidates` → `resolveReactionsWindow` (opportunité, contre‑sort, bouclier, readied…). Après usage : `reactionAvailable=false`. Revalidation des intents après chaque réaction. Segmentation des mouvements pour limiter interruptions.
3) **Validation** : portée/ligne de vue/munitions/`reactionAvailable`. `re-check _alive` avant commit.
4) **Commit** séquentiel ; mini‑commits persistés (snapshots). Rollback/skip si invalidé.
5) **Archivage** : en fin d’*encounter*, archiver le batch complet (`archivedBatches`) pour debug.

**IA d’action**
- PNJ/monstres : politique hybride :
  - *Simple* (algo heuristique) : distance, faiblesse, focus cible blessée.
  - *Avancé* (LLM) : si `importance="high"` ou boss.
- Conseils & ordres : pendant le tour du joueur seulement ; influence PNJC.

**Intégration théâtre** (placeholder) : `theater_construct` gérera les zones/portées ; Castagne consommera ces données sans dépendre d’un moteur 3D.

---

## 7) Module_Caboche — mémoire & journal
**Routines**
- `DAY_TICK` (changement de jour en jeu).
- Digest de narration (résumé court), extraction de **faits structurés** : quêtes, relations, visites, loot, issues de combats.
- *Focus window* = contexte récent condensé (limite tokens) ; le reste archivé (chapitrage).

**Structures**
- Journal (libre) : `JournalEntry { day, text, tags }`
- Quêtes : importance, récompense, type (enquête/assassinat/mercenariat/…)
- Relations : score, résumé, dernier jour vu.
- Visites : lieu, résumé, jour.
- Chapitrage : index de segments historiques consultables par l’IA.

---

## 8) Module_Bonome — création & fiches
- Wizard PJ multi‑étapes : espèce/classe/sous‑classe/background → répartition de caractéristiques (3 modes : manuel, point-buy, dés) → compétences → équipement → sorts.
- Calculs automatiques (CA, bonus, dérivés). Respect 5e + règles maison (cf. § 11 à préciser).
- PNJC : génération IA avec verrous (pas toutes options), même calculs.
- Boss : données issues d’un dépôt (Valmorin) via `monstre_expand`.
- Éditions limitées : hors combat, inventaire & équipement seulement.

---

## 9) Module_Dodo — repos & besoins
- Étape 1 : validation contexte (safe ?). Si doute → jet événement (péripétie) sinon déroulé normal.
- Repos long : récupération de sorts, préparation, harmonisation, besoins (manger/boire/dormir).
- Intégré à la temporalité (faim/soif/sommeil) avec règles simples pour MVP.

---

## 10) Persistance & états
**Event Sourcing léger**
- Table `event_log(id, gameId, type, payload, createdAt, causedBy)`
- Projections (tables vues) : `characters`, `inventory`, `quests`, `relations`, `visits`, `encounters`, `journal`…
- Snapshots combat : `encounter_snapshots(encId, seq, stateJson)`.

**Mémoire par portée**
- Mémoire *fiches* (PJ/PNJC/montures/creatures)
- Mémoire *combats* (par encounter)
- Mémoire *monde* (temps, quêtes globales…)

---

## 11) Règles & contenu (à cadrer proprement)
- **5e + règles maison** :
  - Montures & créatures apprivoisées (Module_Bebette futur)
  - PNJC avec qualités/défauts pris en compte par l’IA
  - Fenêtre de réactions obligatoire avant résolution d’actions déclenchantes
- **Sources** monstres/sorts : via `monstre_expand`/`spells_expand` (licences à vérifier). Fallback minimal embarqué pour le MVP.

---

## 12) UI/Pages & navigation
- **/ (Accueil)** : « Nouvelle partie » → crée `gameId` + ouvre Wizard.
- **/wizard** : étapes Bonome, sauvegarde brouillon auto.
- **/aventure** :
  - Zone centrale : chat MJ IA
  - Deux entrées : *Histoire* (narration diegétique), *MJ* (méta‑consigne)
  - Onglets : *Fiche*, *Journal*, *Carte* (placeholder)
  - Panneau latéral : Quêtes & Relations (Caboche)
  - Popups : confirmations de commandes, choix d’attaque/réaction

---

## 13) Dossier & code (monorepo)
```
apps/web (Nuxt3)
  /pages        -> index.vue, wizard.vue, aventure.vue
  /components   -> ChatPanel.vue, ChoiceModal.vue, SheetView.vue, JournalTab.vue, QuestPanel.vue
  /stores       -> game.ts, ui.ts
  /server/api   -> intent.post.ts, command.post.ts, events.get.ts
  /lib          -> rules/, dice/, schemas/ (zod), gepeto/
  /styles       -> tailwind.css

prisma/         -> schema.prisma
```

---

## 14) Sécurité & robustesse
- Toujours valider côté serveur (zod + règles).
- Pas de *side‑effects* dans Gépéto : uniquement des `Command`.
- Journalisation complète des erreurs + *replay* via `EventStore`.
- RNG centralisé (`dice_helper`) avec seed par partie (reproductible si besoin).

---

## 15) Plan de livraison (Sprints)
**S0 – Bootstrap (2–3 j)** : Nuxt3 + Prisma + SQLite + Tailwind, pages vides, CI.

**S1 – Wizard minimal (3–5 j)** : Bonome (espèce/classe, caracs, fiche calcule CA/HP), sauvegarde PJ.

**S2 – Aventure & Gépéto v1 (3–5 j)** : Chat, `/api/intent`, mapping → `BUY_ITEM`/`CREATE_QUEST`/`COMBAT_SURPRISE_ENEMY`.

**S3 – Castagne v1 (5–7 j)** : surprise, initiative, attaque simple, réactions (bouclier/opportunité), preview→commit, journal d’events.

**S4 – Caboche v1 (3–4 j)** : Journal visible, `CREATE_QUEST` → liste, relations & visites rudimentaires, `DAY_TICK`.

**S5 – Dodo v1 (2–3 j)** : Repos court/long + péripéties simples + besoins basiques.

**S6 – Finitions & tests (continu)** : tests règle/dés ; sauvegarde/chargement ; polish UI.

---

## 16) Points à clarifier (propositions en italique)
1. **Périmètre règles maison** détaillé ? *On peut commencer avec : montures actives, PNJC traits (±2 mod), fenêtre réactions obligatoire.*
2. **Source de données monstres/sorts** (licence) ? *MVP : bestiaire réduit en local + champs d’extension.*
3. **IA vs Algo pour PNJ/monstres** ? *Heuristique par défaut, IA si boss/importants.*
4. **Mono‑joueur vs multi** ? *MVP solo ; multi plus tard via Socket.IO.*
5. **Langue** (FR/EN) ? *FR d’abord, i18n ensuite.*
6. **Sauvegarde/chargement multi‑parties** ? *Dès S2 : `gameId` multiple.*
7. **Carte & théâtre** : 2D grid simple plus tard ? *Placeholder S0 ; design S4+.*
8. **Compatibilité D&D 5e stricte** (licences) ? *Valider avant import massif.*
9. **V8.1.rar** : doit‑on réutiliser des morceaux ? *Audit rapide quand vous le souhaitez.*

---

## 17) Extraits JSON d’exécution
### 17.1 BUY_ITEM (avec confirmation)
```json
{
  "id":"cmd_001","gameId":"g_1","type":"BUY_ITEM",
  "payload":{"buyerId":"pj_1","itemId":"itm_ration","qty":2,"price":5},
  "meta":{"requiresConfirmation":true,"confidence":0.88}
}
```

### 17.2 CREATE_QUEST (auto)
```json
{
  "id":"cmd_002","gameId":"g_1","type":"CREATE_QUEST",
  "payload":{"title":"Chasse à la prime : brigands du pont","importance":"med","reward":110}
}
```

### 17.3 COMBAT_SURPRISE_ENEMY → événements
```json
[
 {"type":"ENCOUNTER_STARTED","payload":{"encounterId":"enc_9","surprise":"enemy"}},
 {"type":"INITIATIVE_ROLLED","payload":{"encounterId":"enc_9","order":["mon_a","pj_1","mon_b","pnjc_1"]}}
]
```

---

## 18) Mini API (Nuxt server)
```ts
// /server/api/intent.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody<{ message: string; gameId: string }>(event)
  // 1) récupérer focus window Caboche
  // 2) appeler service Gépéto → intents
  // 3) retourner Command[] validés (zod)
})

// /server/api/command.post.ts
export default defineEventHandler(async (event) => {
  const cmd = await readBody<CommandBase>(event)
  // zod.validate(cmd)
  // route vers module propriétaire
  // preview → réactions → commit → events
  // return { ok: true }
})
```

---

## 19) Qualité & débloquants
- **Logs** lisibles (console + DB), *replay* d’une partie via `event_log`.
- **Seed RNG** par partie pour debug.
- **Schemas Zod** publiés côté front pour génération de formulaires/validations.
- **Feature flags** (activer IA PNJ, théâtre, etc.).

---

## 20) Prochaines actions concrètes
1) Initialiser le repo Nuxt3 + Prisma + SQLite + Tailwind (S0).
2) Ébaucher schémas Zod `Command`/`Event` partagés.
3) Maquettage UI Aventure (chat + popups de confirmation).
4) Bonome v0 : wizard 4 étapes + calculs CA/HP.
5) Gépéto v0 : mapping `achat/quête/combat` → 3 commandes JSON ci‑dessus.
6) Castagne v0 : *surprise → initiative → attaque simple → réactions → commit → journal*.
7) Caboche v0 : journal du jour + création de quête + liste de relations/visites minimales.

---

# [S0 Bootstrap] — Checklist
- [ ] Node.js LTS & pnpm installés localement (*gratuit*).
- [ ] Projet `jdr-web` créé (Nuxt 3 + TS + Tailwind).
- [ ] Prisma configuré (SQLite) + `prisma db push` OK.
- [ ] Pages : `/` (Accueil), `/wizard`, `/aventure` (squelettes).
- [ ] Stores Pinia : `game.ts` (gameId, session), `ui.ts`.
- [ ] API serveur : `intent.post.ts`, `command.post.ts`, `events.get.ts` (mock OK).
- [ ] Schémas Zod : `Command`, `Event` (+ types partagés TS).
- [ ] Faux Gépéto (parser simple) + **toggle** `USE_FAKE_AI`.
- [ ] README avec pas-à-pas local.
- [ ] Zip S0 prêt (à importer et lancer en local).

