# Takoia — Discord Bot

Interface conversationnelle de **Takoia**, plateforme d'agents IA autonomes.
Depuis Discord, on confie un **objectif** à un agent ; l'agent **planifie, agit
et restitue** en 4 étapes (Analyse → Décision → Action → Restitution), suivies
en temps réel dans un embed vivant, avec **validation humaine optionnelle**
(human-in-the-loop) et livraison du rapport final — sans quitter Discord.

> Le bot ne fait **aucun appel LLM**. Toute l'intelligence vit dans
> **core-backend** ; le bot est l'UI : il envoie des requêtes REST et **consomme
> le flux SSE** de progression des jobs.

## Architecture / intégration avec core-backend

Le bot est un **client** de core-backend (Rust/axum). Il n'expose aucun serveur
entrant : la progression arrive via **Server-Sent Events**.

```
   Discord                         core-backend (/api, :8080)
  ┌──────┐   POST /api/objectives  ┌───────────────────────────┐
  │ User │ ──────────────────────► │  REST                     │
  │      │   GET  /api/agents|jobs │                           │
  │      │   POST /api/approvals/:id  enqueue job ─► engine     │
  │      │ ◄────────────────────── │  (4 steps, approval gate) │
  └──────┘   SSE GET /api/jobs/:id/events  (event "progress")  │
     ▲                             └───────────────────────────┘
     │ embeds vivants · boutons ✅/❌ · rapport .md
     └── le bot édite/poste les messages Discord au fil des events SSE
```

- **Sortant (bot → backend)** : `fetch` natif vers `BACKEND_URL/api/...`.
  L'API MVP est **non authentifiée** ; si `SHARED_SECRET` est défini, le bot
  l'envoie en `Bearer` (compatibilité future), sinon rien.
- **Temps réel (backend → bot)** : à la création d'un job, le bot ouvre une
  connexion **SSE** sur `GET /api/jobs/:id/events` et traduit chaque event en
  action Discord. Les approbations à boutons sont **postées par le bot** (c'est
  lui qui possède l'interaction Discord), déclenchées par l'event
  `approval_required`.

> ⚠️ État en mémoire : le lien `jobId → message Discord` vit dans le process
> (pas de DB). Si le bot redémarre, les anciens messages cessent de se mettre à
> jour. Acceptable pour le hackathon.

## Setup en 3 commandes

```bash
bun install
bun run register      # enregistre les slash commands (instantané si GUILD_ID est set)
bun run dev           # lance le bot
```

Avant : `cp .env.example .env` et remplir les variables.

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | token du bot |
| `DISCORD_CLIENT_ID` | application (client) id |
| `GUILD_ID` | guild de test (commandes instantanées) ; vide = global (~1h) |
| `BACKEND_URL` | base URL de core-backend (ex. `http://localhost:8080`) |
| `SHARED_SECRET` | optionnel ; Bearer envoyé si défini (l'API MVP n'a pas d'auth) |

## Commandes

| Commande | Effet |
|---|---|
| `/objectif <texte> [agent]` | lance un objectif ; sans `agent`, en choisit un automatiquement (priorité à un agent qui demande validation, pour la démo). Crée l'embed vivant du job |
| `/agents` | liste les agents et leur niveau d'autonomie (`full_auto` / `confirm_before_action`) |
| `/jobs [statut]` | liste les jobs récents (filtre client-side) |
| `/status <job_id>` | détail d'un job et de ses 4 étapes |
| `/ping` | santé du bot + ping backend (debug démo) |

**Interactions** : embed de timeline mis à jour à chaque event SSE
(`◻️` à venir · `⏳` en cours · `✅` fait · `⏸️` attente validation · `❌` échec) ;
boutons ✅/❌ sur les demandes d'approbation ; rapport final en embed + fichier
`.md` joint si long.

## Contrat (aligné sur core-backend, branche `feat/core-mvp`)

**REST** (validé par zod, `src/types.ts`) :

- `POST /api/objectives` `{ agent_id, title, prompt }` → `{ objective_id, job_id }`
- `GET /api/agents` → `{ agents: [{ id, name, description, autonomy_level, expertise_domain }] }`
- `GET /api/jobs` → `{ jobs: [{ id, agent_id, status, title, created_at }] }`
- `GET /api/jobs/:id` → `{ job, steps:[{ step_type, status, output }], report }`
- `POST /api/approvals/:id` `{ decision: "approve"|"reject" }` → `{ status, job_id }`

**SSE** `GET /api/jobs/:id/events` (event `progress`, data = `JobEvent`) :

```json
{ "job_id": "...", "kind": "job_status|step_started|step_completed|log|approval_required|report",
  "step_type": "analyse|decision|action|restitution", "status": "running|done|awaiting_approval|...",
  "message": "...", "data": { } }
```

- `approval_required` → `data.approval_id` + `message` (résumé de l'action) → le bot poste les boutons.
- `report` → `data.markdown` → le bot livre le rapport (embed + `.md` si long).

## Démo (déroulé)

Recommandé : **2 terminaux**.

```bash
# Terminal 1 — bot
bun run register && bun run dev

# Terminal 2 — mock backend SSE (filet de sécurité démo, imite core-backend)
PORT=8080 bun run mock
# (mettre BACKEND_URL=http://localhost:8080 dans .env)
```

Puis sur Discord :

1. `/ping` → bot en ligne + backend OK.
2. `/objectif fais une veille sur les agents IA et produis un rapport`
   → un embed apparaît et les 4 étapes défilent en direct (via SSE).
3. À l'étape **Action**, un message à boutons demande validation → clic **✅**.
4. Le job se termine et le **rapport final** est livré (embed + `.md`).

Le `mock` (`scripts/mock-backend.ts`) reproduit le **vrai** contrat SSE sur des
timers : idéal pour répéter la démo et **garder un fallback si core-backend
n'est pas prêt** en live.

## Stack

Bun + TypeScript (strict) · discord.js v14 · SSE (`fetch` streaming) · zod.
