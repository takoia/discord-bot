# Takoia — Discord Bot

Interface conversationnelle de **Takoia**, plateforme d'agents IA autonomes.
Depuis Discord, on confie un **objectif** à un agent ; l'agent **planifie, agit
et restitue** en 4 étapes (Analyse → Décision → Action → Restitution), suivies
en temps réel dans un embed vivant, avec **validation humaine optionnelle**
(human-in-the-loop) et livraison du rapport final — sans quitter Discord.

> Le bot ne fait **aucun appel LLM**. Toute l'intelligence vit dans
> **core-backend** ; le bot est l'UI : il envoie des requêtes REST et réagit aux
> événements poussés par le backend.

## Architecture / intégration avec core-backend

```
                 REST (Bearer)
   Discord  ┌──────────────────────►  ┌──────────────┐
  ┌──────┐  │  POST /api/objectives    │ core-backend │
  │ User │◄─┤  GET  /api/agents|jobs   │   (LLM,      │
  └──────┘  │  POST /api/approvals/:id │   agents)    │
     ▲       └─────────  bot  ◄─────────┤              │
     │ embeds         HTTP (Bearer)     └──────────────┘
     │ boutons        POST /events       module `notify`
     └─────────────── POST /approvals    pousse les events
                      POST /reports
```

- **Sortant (bot → backend)** : `fetch` natif vers `BACKEND_URL/api/...`,
  toujours avec `Authorization: Bearer <SHARED_SECRET>`.
- **Entrant (backend → bot)** : `Bun.serve` expose `/events`, `/approvals`,
  `/reports` (mêmes Bearer). Le bot transforme chaque event en message Discord.

**Choix d'archi assumé** : les approbations à boutons sont *postées par le bot*
(c'est lui qui possède l'interaction Discord). Donc même si le backend préfère
SSE/webhook pour les notifs simples, le **endpoint HTTP `/approvals` reste le
contrat principal**.

> ⚠️ État en mémoire : le lien `jobId → message Discord` vit dans le process
> (pas de DB). Si le bot redémarre, les anciens messages cessent de se mettre à
> jour. Acceptable pour le hackathon.

## Setup en 3 commandes

```bash
bun install
bun run register      # enregistre les slash commands (instantané si GUILD_ID est set)
bun run dev           # lance le bot + le serveur HTTP entrant
```

Avant : `cp .env.example .env` et remplir les variables.

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | token du bot |
| `DISCORD_CLIENT_ID` | application (client) id |
| `GUILD_ID` | guild de test (commandes instantanées) ; vide = global (~1h) |
| `BACKEND_URL` | base URL de core-backend |
| `SHARED_SECRET` | secret partagé (Bearer dans les deux sens) |
| `PORT` | port du serveur HTTP entrant (défaut 3000) |

## Commandes

| Commande | Effet |
|---|---|
| `/objectif <texte> [agent]` | lance un objectif ; crée l'embed vivant du job |
| `/agents` | liste les agents et leur niveau d'autonomie |
| `/jobs [statut]` | liste les jobs récents |
| `/status <job_id>` | détail d'un job et de ses 4 étapes |
| `/ping` | santé du bot + ping backend (debug démo) |

**Interactions** : embed de timeline mis à jour à chaque event
(`◻️` à venir · `⏳` en cours · `✅` fait · `⏸️` attente validation · `❌` échec) ;
boutons ✅/❌ sur les demandes d'approbation ; rapport final en embed + fichier
`.md` joint si long.

## Contrat des événements entrants

Tous en `POST`, protégés par `Authorization: Bearer <SHARED_SECRET>`.
Réponses : `200 {ok:true}`, `400` payload invalide, `401` secret invalide,
`404` job inconnu. Schémas validés par zod (`src/types.ts`).

**`POST /events`** — avancement
```json
{ "jobId": "job_1", "step": "analyse",
  "status": "running|done|waiting_approval|failed",
  "output": "texte court (optionnel)", "jobStatus": "running|done|... (optionnel)" }
```
`step` ∈ `analyse | decision | action | restitution`.

**`POST /approvals`** — validation humaine
```json
{ "approvalId": "appr_1", "jobId": "job_1",
  "action": "ce que l'agent veut faire",
  "reason": "pourquoi (optionnel)", "step": "action (optionnel)" }
```
Au clic, le bot appelle `POST /api/approvals/:approvalId` avec
`{ "decision": "approve"|"reject", "by": "<discord_user>" }`.

**`POST /reports`** — livrable
```json
{ "jobId": "job_1", "title": "…", "summary": "résumé embed",
  "markdown": "# Rapport complet…" }
```
Markdown > ~3500 caractères → joint en fichier `.md`.

## Démo (déroulé)

Recommandé : **2 terminaux**.

```bash
# Terminal 1 — bot
bun run register && bun run dev

# Terminal 2 — mock backend (filet de sécurité démo, simule core-backend)
SHARED_SECRET=<le_même> BOT_URL=http://localhost:3000 PORT=8080 bun run mock
# (mettre BACKEND_URL=http://localhost:8080 dans .env)
```

Puis sur Discord :

1. `/ping` → bot en ligne + backend OK.
2. `/objectif fais une veille sur les agents IA et produis un rapport`
   → un embed apparaît et les 4 étapes défilent en direct.
3. À l'étape **Action**, un message à boutons demande validation → clic **✅** .
4. Le job se termine et le **rapport final** est livré (embed + `.md`).

Le `mock` joue exactement ce scénario sur des timers : idéal pour répéter la
démo et **garder un fallback si core-backend n'est pas prêt** en live.

## Stack

Bun + TypeScript (strict) · discord.js v14 · `Bun.serve` · `fetch` natif · zod.
