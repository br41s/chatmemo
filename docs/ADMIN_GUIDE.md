# ChatMemo — Admin Guide

> This guide covers installation, configuration, maintenance, and troubleshooting of a self-hosted ChatMemo instance.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Installation](#3-installation)
4. [Environment Variables](#4-environment-variables)
5. [Database Setup](#5-database-setup)
6. [Running the App](#6-running-the-app)
7. [Sync Setup (Bookmarklet + Claude Code Hook)](#7-sync-setup-bookmarklet--claude-code-hook)
8. [Model Configuration](#8-model-configuration)
9. [Upgrading](#9-upgrading)
10. [Troubleshooting](#10-troubleshooting)
11. [Security Notes](#11-security-notes)
12. [Backup & Restore](#12-backup--restore)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│  ┌────────────┐   ┌──────────────────────────────┐  │
│  │ ChatMemo   │   │ claude.ai + bookmarklet       │  │
│  │ Next.js 15 │   │ (fires POST /api/import/…)   │  │
│  └──────┬─────┘   └──────────────────────────────┘  │
└─────────┼───────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│  Server (localhost:3000 or Vercel)                  │
│                                                     │
│  /api/import/conversation  ← bookmarklet            │
│  /api/import/claude        ← bulk Claude export     │
│  /api/import/chatgpt       ← bulk ChatGPT export    │
│  /api/import/perplexity    ← bulk Perplexity export │
│  /api/import/clear-source  ← selective source clear │
│  /api/import/restore       ← restore from backup    │
│  /api/export/summaries     ← export grouped by src  │
│  /api/memory/summarize     ← auto-summarise + lessons│
│  /api/chat/openrouter      ← chat completions       │
│  /api/chat/custom          ← remote custom models   │
│  /api/retrieval/*          ← authorised file search │
│  /api/timeline             ← conversation timeline  │
│                                                     │
│  lib/server/openrouter.ts       ← shared LLM helpers│
│  lib/server/inject-memory.ts    ← central injector  │
│  lib/server/get-latest-summary.ts ← baseline blob  │
│  lib/server/get-relevant-memory.ts ← relevance     │
│  lib/server/get-full-conversation.ts ← full recall │
│  lib/db/lessons.ts              ← user_lessons DB   │
│  lib/importers/shared.ts        ← importer utils    │
│  lib/importers/perplexity.ts    ← Perplexity parser │
│  db/summaries.ts                ← watermark helpers │
└──────────────┬──────────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
  OpenRouter API    Supabase (Postgres + Auth)
  (summarisation    (summaries, user_lessons,
   + lessons)        chats, messages)
```

Local Ollama models follow a separate path: the browser discovers models at `NEXT_PUBLIC_OLLAMA_URL/api/tags` and streams chat directly from `NEXT_PUBLIC_OLLAMA_URL/api/chat`. The public Next.js server never attempts to reach `localhost` or the Mac's LAN. Remote custom models use `/api/chat/custom`, which reloads the stored model through the user's Supabase session and only connects to validated public HTTPS destinations.

**Claude Code scripts** (run outside the Next.js server, talk to Supabase/OpenRouter directly):

| Script                               | Purpose                                    |
| ------------------------------------ | ------------------------------------------ |
| `scripts/sync-to-chatmemo.mjs`       | Stop hook — fires after every VS Code turn |
| `scripts/import-claude-sessions.mjs` | One-shot bulk import of all past sessions  |
| `scripts/watch-claude-sessions.mjs`  | Background daemon for macOS app auto-sync  |
| `scripts/claude-sessions-shared.mjs` | Shared utilities for the above three       |

All scripts use `~/.chatmemo/config.json` (written by `setup:sync`) and track imported sessions in `~/.chatmemo/imported-sessions.json`.

### Memory retrieval (three layers)

Memory injection is centralised in **`lib/server/inject-memory.ts`** and shared by **every** provider chat route (openrouter, openai, anthropic, mistral, groq, perplexity, azure, google, and the tools route) — so the model knows about the user regardless of which model is selected. The injector handles both message shapes (OpenAI `{ role, content }` and Google Gemini `{ role, parts:[{text}] }`) and fails open: if any retrieval query throws, the chat continues with no memory rather than erroring. Two paths place the block differently. `custom` injects only when the model belongs to the requesting user; a shared model is another user's endpoint and receives no memory. Ollama runs in the browser against `localhost`, so the browser fetches the block from `POST /api/memory/block` and prepends it itself, keeping inference local. The three retrieval layers run in parallel before the completion call:

1. **Baseline — compact summaries** (`lib/server/get-latest-summary.ts`). Every chat gets up to ~100 k chars of context: the lessons document, personal rows (capped 1 500 chars each), and bulk import rows (Perplexity/ChatGPT, capped **400 chars** each). Keeps the prompt small but bulk rows are title-only.

2. **Always-on — relevance retrieval** (`lib/server/get-relevant-memory.ts`). On **every** turn, searches **all** summaries by the quoted phrases + topic words of the user's latest message, ranks candidates by distinct-term coverage (`rankByTermCoverage`, shared with layer 3), and injects the top matches **untruncated** (per-row cap 2 000 chars, total budget 6 000) as a `[RELEVANT MEMORY]` block. This is what surfaces bulk-import **detail** (flight numbers, dates, prices, decisions) for ordinary questions — the baseline blob only carries titles. **Cost control:** returns immediately with **no DB call** when the message has no meaningful topic words (greetings, acks, and conversational filler like _thanks_/_hola_ are filtered). Skipped when layer 3 finds a match (the verbatim transcript already answers).

3. **On-demand — full conversation recall** (`lib/server/get-full-conversation.ts`). Only fires when the user's message contains an explicit "full conversation" intent (English or Spanish — e.g. _"recover the full conversation"_, _"recupera la conversación completa"_, _"transcript"_, _"recupera la primera del 2026-03-31"_). Intent detection is pure string/regex matching with **no DB cost** unless triggered. When it fires it searches, untruncated:

   - the **`summaries`** table — where imported full text lives. Perplexity and Claude store the complete conversation; ChatGPT stores a copy truncated at import time. Matched by quoted title prefix, topic words, or an explicit `YYYY-MM-DD` date (matched against the embedded `### [YYYY-MM-DD]` header).
   - the **`messages`** table — full transcripts of in-app ChatMemo chats, matched by `chats.name` and/or date.

   Results are injected as a `[FULL CONVERSATION RETRIEVAL]` block (per-row cap 20 k chars, total cap 50 k) and the model is told to treat it as the verbatim source of truth. On a match the baseline + relevance layers are dropped to avoid overflowing the context window. **Caveat:** ChatGPT imports cannot be recovered in full (truncated at import); Perplexity/Claude/in-app can. `ILIKE` matching is accent-sensitive.

---

## 2. Prerequisites

| Tool               | Version              |
| ------------------ | -------------------- |
| Node.js            | 18 or later          |
| npm                | 9 or later           |
| Git                | any recent           |
| Supabase account   | free tier sufficient |
| OpenRouter account | free tier sufficient |

---

## 3. Installation

```bash
# 1. Clone the repository
git clone https://github.com/braisntext/chatmemo.git
cd chatmemo

# 2. Install dependencies
npm install

# 3. Copy the environment file
cp .env.local.example .env.local   # or copy the template below
```

---

## 4. Environment Variables

Edit `.env.local`. Required fields are marked **★**.

```env
# ── Supabase ★ ──────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# ── OpenRouter ★ ────────────────────────────────────
# Used for all summarisation (imports, bookmarklet, in-app).
# Get your key at https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-...

# ── Import tokens ★ ─────────────────────────────────
# Bearer tokens for /api/import/conversation. One per writer, so a leak is
# revoked on its own: the general token is held by the laptop scripts and
# embedded in the bookmarklets; the cloud token sits in the Claude Code cloud
# environment, where any command can read it, and may only post Claude Code
# sessions. Generate each with:
#   node -e "require('crypto').randomBytes(32,(_,b)=>console.log(b.toString('hex')))"
CHATMEMO_IMPORT_TOKEN=<general token>
CHATMEMO_CLOUD_IMPORT_TOKEN=<cloud token, optional>
# The account every token posts into. With one user in the project this is
# found on its own; with several, say which one is you.
CHATMEMO_OWNER_EMAIL=you@example.com
CHATMEMO_IMPORT_USER_ID=<set automatically by npm run setup:sync>

# ── File upload size limit (bytes) ──────────────────
NEXT_PUBLIC_USER_FILE_SIZE_LIMIT=10485760  # 10 MB (chat file attachments)
# Note: import routes (ChatGPT/Claude) have their own 100 MB limit in code

# ── Local models via Ollama ─────────────────────────
# Read by the browser. Intended for ChatMemo running on the same Mac.
NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434

# ── Optional provider keys ──────────────────────────
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GEMINI_API_KEY=
```

### Supabase keys

Find them at **Supabase dashboard → Project Settings → API**.

- `NEXT_PUBLIC_SUPABASE_URL` — the project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key (safe to expose client-side).
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**. Never expose in client code. Reserved for explicitly trusted import/sync operations; authenticated chat, custom-model, username, and file-retrieval paths use the user's session and Row Level Security.

---

## 5. Database Setup

ChatMemo uses Supabase migrations stored in `supabase/migrations/`.

```bash
# Local development (requires Supabase CLI)
supabase start
npm run db-migrate   # runs all pending migrations
npm run db-types     # regenerates TypeScript types from schema

# Remote (production)
npx supabase link --project-ref <your-project-ref>
npm run db-push          # apply pending versioned migrations
npm run db-types-remote  # regenerate types from the linked database
```

`npm run db-push` should finish with the local and remote migration histories aligned. Use `npx supabase migration list --linked` and `npx supabase db push --linked --dry-run` to verify. Do not paste migration files individually or use `migration repair` unless you have first proven that the corresponding schema objects and policies already exist remotely.

### Key tables

| Table                              | Purpose                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `summaries`                        | Memory rows. Append-only. Includes raw conversation excerpts, LLM summaries, and date-index rows. |
| `user_lessons`                     | Self-improving knowledge doc. One row per user, upserted after each session.                      |
| `profiles`                         | User profile (display name, API keys, settings).                                                  |
| `chats`                            | Chat sessions.                                                                                    |
| `messages`                         | Individual messages within a chat.                                                                |
| `models`                           | Remote OpenAI-compatible model definitions. Shared rows cannot contain API keys.                  |
| `tools`                            | OpenAPI tool definitions. Shared rows must contain public, credential-free configuration.         |
| `files` / `file_items`             | Uploaded files and versioned retrieval chunks. Only active chunks are retrieved or shared.        |
| `collections` / `collection_files` | File grouping and the ownership-checked links used for collection sharing.                        |

### Performance indexes

These indexes cover the middleware home-workspace lookup and memory-retrieval queries:

```sql
CREATE INDEX IF NOT EXISTS idx_workspaces_user_home
  ON workspaces (user_id, is_home);

CREATE INDEX IF NOT EXISTS idx_summaries_user_created
  ON summaries (user_id, created_at DESC);
```

They are included in migration `20260520000000_perf_indexes.sql` and are applied automatically by `supabase db push`; the SQL is shown only for diagnostics.

### Migration state

The production project is synchronized through `20260728020000_file_items_visible_through_collections.sql`. That sequence includes `user_lessons`, performance indexes, authenticated username RPCs, credential-free sharing for tools and remote models, transactional file-chunk replacement, and collection-aware file visibility. A fresh project should receive the same state only through the ordered files in `supabase/migrations/`.

### RLS policies on `summaries`

All operations are scoped to `auth.uid() = user_id`:

| Operation | Policy                 |
| --------- | ---------------------- |
| SELECT    | `user_id = auth.uid()` |
| INSERT    | `user_id = auth.uid()` |
| DELETE    | `user_id = auth.uid()` |

The **service role key** bypasses RLS — used only by `/api/import/conversation` on the server, which scopes every write to the user a token resolved to. The laptop scripts and the cloud hook hold an import token, never this key. Storage cleanup has its own key: `delete_storage_object`, which the `delete_old_*` triggers call to remove a deleted row's file from Storage, reads `storage_delete_project_url` and `storage_delete_service_role_key` from Vault. The latter holds a dedicated secret key (`sb_secret_…`, named `storagecleanup`), sent in the `apikey` header; a legacy `service_role` JWT also works (sent as `Authorization: Bearer` too). `anon`, `authenticated` and other `PUBLIC` roles can neither run the function nor read the secrets.

Additional sharing rules are enforced in the database:

- Shared remote models must have an empty `api_key`; keyed models remain owner-only.
- Shared tools must have empty custom headers, a public HTTPS URL without query credentials, and a schema without authentication fields or embedded secrets.
- File chunks can only be written by the file owner. Shared collections expose only active chunks belonging to a valid same-owner collection/file link.
- Username lookup RPCs require an authenticated session and expose only the requested scalar result, not profile rows.

---

## 6. Running the App

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start

# Full restart with Supabase local
npm run restart
```

The app runs at `http://localhost:3000` by default.

**First run:** sign up at `http://localhost:3000` to create your user account before running `setup:sync`.

---

## 7. Sync Setup (Bookmarklet + Claude Code Hook)

Run **once** after installation, and again if you change `CHATMEMO_IMPORT_TOKEN` or sign up with a new account:

```bash
npm run setup:sync
```

This script:

1. Reads credentials from `.env.local`.
2. Finds your Supabase user through the admin API: the one `CHATMEMO_OWNER_EMAIL` names, or the only one there is. With several accounts and no email it stops, rather than binding every token to whoever signed up last.
3. Writes `CHATMEMO_IMPORT_USER_ID` to `.env.local`, and sets the file to mode 600.
4. Writes `~/.chatmemo/config.json` (mode 600) with the import token, the deployment URL and the `excludeProjects` list. No database or OpenRouter key leaves `.env.local`: the scripts post sessions to the server, which holds the keys.
5. Registers the Stop and SessionEnd hooks in `~/.claude/settings.json`. It stops if that file does not parse, instead of writing over it.
6. Writes the two bookmarklets to `~/.chatmemo/bookmarklets.txt` (mode 600) — they carry the token, so they are not printed.

### Bookmarklet

Open `~/.chatmemo/bookmarklets.txt`, copy a URL and add it to your browser bookmarks bar (right-click → Add page → paste URL). Name them **Save to ChatMemo (Claude)** and **Save to ChatMemo (Gemini)**.

The bookmarklet uses three fallback strategies to detect messages on claude.ai:

| Priority | Selector                                                           | Notes                                |
| -------- | ------------------------------------------------------------------ | ------------------------------------ |
| 1        | `[data-message-author-role]`                                       | Future-proof attribute               |
| 2        | `[class*="font-user-message"]` + `[class*="font-claude-response"]` | Current claude.ai classes (May 2026) |
| 3        | `[class*="human-turn"]` etc.                                       | Generic fallback                     |

If claude.ai changes its HTML structure, update the selector constants in `scripts/chatmemo-hook-setup.mjs` and re-run `npm run setup:sync`.

### Claude Code Hook (VS Code)

The hook is registered for two events: `Stop`, which fires after every Claude Code turn, and `SessionEnd`. It:

- Reads the JSONL transcript from `~/.claude/projects/<slug>/<session-id>.jsonl`.
- Summarises a session once it has 3 user messages, again every 5 user messages after that, and a last time at `SessionEnd`. Each new summary replaces the session's previous row, so memory holds the whole session, not just its opening.
- Tracks each session's size in `~/.chatmemo/imported-sessions.json`. A session the old laptop path wrote itself (its entry carries a `rowId`) sends that id along once, and the server retires the row; sessions synced before row ids were recorded are left as they are.
- Posts to `/api/import/conversation` with the import token, like the cloud hook; the server summarises and stores the session. The laptop never calls OpenRouter or the database.
- Before the post, drops the blocks Claude Code injects into user turns (`!` command output, local slash-command output, system reminders) and replaces anything shaped like a credential (API keys, JWTs, `user:password@` in URLs, `KEY=value` with a telling name, private keys). Both passes live in `public/hooks/chatmemo-cloud-sync.mjs`, which the laptop scripts import, so every path cleans a transcript the same way.
- Keeps a project out when its directory holds a `.chatmemo-nosync` file, or when its path is in `excludeProjects` in `~/.chatmemo/config.json` (the watcher and the bulk importer match the path against the project slug under `~/.claude/projects/`).
- Runs the work in a detached process, so Claude Code never waits on the summariser.
- Logs every outcome, failures included, to `~/.chatmemo/sync.log` — status and the server's one-line reason, never a response body.

After updating ChatMemo, re-run `npm run setup:sync` to register `SessionEnd`.

To verify the hook is registered and working:

```bash
grep -c sync-to-chatmemo ~/.claude/settings.json   # 2 = Stop and SessionEnd
tail -20 ~/.chatmemo/sync.log
```

The rows are written with `content` only; the `summaries_derive_metadata` trigger (migration `20260924000000`) classifies them. Without that migration applied, they are stored but never read — check with `select count(*) from summaries where kind is null`.

### Claude Code cloud sessions

Sessions the Claude Code desktop app (or claude.ai/code) runs **in the cloud** never touch your Mac, so neither the hook above nor the watcher sees them. They are synced from inside the cloud container instead: a hook posts the session to `/api/import/conversation`, which summarises it with the server's OpenRouter key and stores it. The container needs no database or OpenRouter credentials.

In the cloud environment's settings (the environment menu in a session's title bar → **Edit**):

1. Give the deployed app the cloud token: `CHATMEMO_CLOUD_IMPORT_TOKEN` in Vercel's environment variables (and in `.env.local`), a different value from `CHATMEMO_IMPORT_TOKEN`. Without it the hook's posts are refused with 401, and the only log of that is inside the container.
2. Add the environment variable `CHATMEMO_IMPORT_TOKEN` to the cloud environment with that cloud token as its value. It may only post Claude Code sessions. Every command the agent runs in the container can read its environment, so the general token does not belong there.
3. Allow network access to `chatmemo-one.vercel.app`.
4. Add to the **Setup script**:

```bash
# ChatMemo: sync this environment's Claude Code sessions into memory.
# Download, and install only if it is exactly the hook this guide was written
# for: the app serves it, so whoever controlled the deployment could otherwise
# run code in every session container. The repo's tests keep this hash current
# (__tests__/scripts/cloud-hook-pin.test.ts); after the hook changes, copy the
# new value from the guide.
expected_sha256="d9882fd3715b60d598dcad203a9e47bdb58bb942bee4b68d2a2c0b68329dede3"
mkdir -p "$HOME/.claude/hooks"
hook="$HOME/.claude/hooks/chatmemo-cloud-sync.mjs"
tmp="$HOME/.claude/hooks/chatmemo-cloud-sync.download.mjs"
if curl -fsSL https://chatmemo-one.vercel.app/hooks/chatmemo-cloud-sync.mjs -o "$tmp" \
  && [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$expected_sha256" ]; then
  mv "$tmp" "$hook"
else
  echo "ChatMemo: hook not installed (download failed or hash differs from the guide's)" >&2
  rm -f "$tmp"
fi
# Register it only if it is there, so a failed download adds no broken hook.
[ -f "$hook" ] && node -e '
const fs = require("fs"), os = require("os")
const file = os.homedir() + "/.claude/settings.json"
let s = {}
try { s = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
s.hooks = s.hooks || {}
const command = "node " + os.homedir() + "/.claude/hooks/chatmemo-cloud-sync.mjs"
for (const event of ["Stop", "SessionEnd"]) {
  s.hooks[event] = s.hooks[event] || []
  if (!s.hooks[event].some(e => (e.hooks || []).some(h => h.command === command)))
    s.hooks[event].push({ matcher: "", hooks: [{ type: "command", command }] })
}
fs.writeFileSync(file, JSON.stringify(s, null, 2))
' || true
```

The hook (`public/hooks/chatmemo-cloud-sync.mjs`, served by the deployed app) posts once a session has 3 user messages, again every 5 more, and at session end. Each post carries `sessionKey: "claude-code:<session id>"`, so the new summary replaces the session's previous row (`summaries.external_id`, migration `20260929010000`). It drops injected blocks and redacts credentials the same way the laptop sync does, and a `.chatmemo-nosync` file in the repository keeps the session out. It returns immediately and does the work in a detached process; outcomes go to `~/.chatmemo-cloud/sync.log` inside the container. Set `CHATMEMO_URL` (https only) to point it at a different deployment.

Only sessions started after the setup script is in place are synced; earlier cloud sessions stay missing.

### Upgrading from the key-based sync

Before the token-only sync, `~/.chatmemo/config.json` held the service-role key, at the default file mode, and the general token was printed to the terminal. Scoping the cloud token protects nothing while those are still valid, so after `npm run setup:sync`:

1. Rotate the service-role key in the Supabase dashboard and update `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and on Vercel. Storage cleanup does not use this key (see Storage cleanup key, below).
2. Generate a new `CHATMEMO_IMPORT_TOKEN`, update it in `.env.local` and on Vercel, run `npm run setup:sync` again, and replace the bookmarklets.
3. If the watcher is installed, reload it so it runs the new code: `launchctl unload` then `launchctl load` on its plist. Until then the running process keeps the old key in memory.

### Storage cleanup key

`storage_delete_service_role_key` in Vault holds the `storagecleanup` secret key. To rotate it: create a new secret key in **Project Settings → API Keys**, then in the SQL editor replace the text between the quotes, angle brackets included:

```sql
select vault.update_secret((select id from vault.secrets where name = 'storage_delete_service_role_key'), 'sb_secret_...');
```

Check it (deletes nothing — the object does not exist); a "not found" answer means the key works, `Unauthorized` means it does not:

```sql
select status, content from public.delete_storage_object('files', 'healthcheck/does-not-exist');
```

Then revoke the old key. With a wrong or missing secret, deleting a file or image leaves the object in Storage and only logs a warning.

### Claude Code Bulk Import

To import all historical sessions from `~/.claude/projects/` in one shot:

```bash
npm run import:claude
```

Shows per-session progress. Safe to interrupt and re-run — already-imported sessions are skipped. LLM failures are not marked as done, so they retry automatically on the next run.

### Claude Code Background Daemon (macOS app)

The macOS Claude Code app does not fire the Stop hook. A background daemon handles auto-sync. It syncs sessions idle for 10+ minutes the same way, re-syncing any that have grown since:

```bash
# Install and start
npm run watch:claude:install
launchctl load ~/Library/LaunchAgents/com.chatmemo.watch-claude-sessions.plist

# Check status
launchctl list | grep chatmemo

# View logs
tail -f ~/.chatmemo/watch.log

# Stop permanently
launchctl unload ~/Library/LaunchAgents/com.chatmemo.watch-claude-sessions.plist
rm ~/Library/LaunchAgents/com.chatmemo.watch-claude-sessions.plist
```

The daemon polls every 5 minutes and processes sessions idle for 10+ minutes. It starts automatically at login.

---

## 8. Model Configuration

### Summarisation model

There are two separate model lists to update — the scripts run on your laptop and cannot import the server's TypeScript:

**Server routes** — defined in `lib/server/openrouter.ts`:

```typescript
export const SUMMARIZE_MODELS = ["openai/gpt-oss-120b"]
```

**Claude Code scripts** — defined in `scripts/claude-sessions-shared.mjs`:

```javascript
export const SUMMARIZE_MODELS = ["openai/gpt-oss-120b"]
```

Each list is tried in order until a model answers, so a cheaper model can go first with a fallback after it. **To change the model**, update both lists, redeploy, and restart the watcher.

> **Note:** `openai/gpt-oss-120b:free` was the first entry until OpenRouter withdrew it (it now answers 404 "unavailable for free"). Free models come and go; check one is still listed on OpenRouter before putting it first.

### Local chat models with Ollama

Ollama is optional and independent from the OpenRouter summarisation model. Install the macOS app from [ollama.com](https://ollama.com/download), then download at least one model:

```bash
ollama pull llama3.2:3b
ollama list
curl http://localhost:11434/api/tags
```

Set the browser-visible endpoint and restart Next.js:

```env
NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434
```

```bash
npm run dev
```

The selector shows an Ollama-backed **Local** tab when `/api/tags` returns models. Inference streams directly between the browser and Ollama; no Ollama API key is stored in Supabase or sent through the Next.js API. Chat messages and generated memories are still persisted to Supabase through ChatMemo's normal authenticated flow.

Keep this endpoint on loopback. Do not expose port `11434` to the public internet. This design assumes ChatMemo is opened locally on the same Mac; a hosted ChatMemo origin may also require an explicit Ollama origin allowlist and is not proxied through the production server.

Remote OpenAI-compatible servers are configured separately under **Models**. They must use public HTTPS endpoints. A model containing an API key is always private; only keyless definitions can be shared.

---

## 9. Upgrading

```bash
# Pull latest code
npm run update   # runs: git pull + db-migrate + db-types

# Restart the server
npm run dev      # or restart your process manager in production
```

After upgrading, re-run `npm run setup:sync` if the setup script was changed.

---

## 10. Troubleshooting

### "User not found" on bookmarklet

The Bearer token is wrong or the server hasn't reloaded the new `.env.local`. Re-run `npm run setup:sync` and restart the dev server.

### "OpenRouter rate limit — wait a moment and try again"

The free model quota is exhausted. Wait 60 seconds. For production use, fund your OpenRouter account and use a paid model.

### "404 No endpoints found for …"

The model ID is invalid or the model was removed from OpenRouter. Update `SUMMARIZE_MODEL` in `lib/server/openrouter.ts` and the mirror in `scripts/sync-to-chatmemo.mjs`, then restart.

### Bookmarklet shows no toast / finds no messages

Claude.ai changed its HTML structure. Run the DOM probe in DevTools:

```js
document.querySelectorAll(
  '[class*="font-user-message"],[class*="font-claude-response"]'
).length
```

If it returns 0, update the selectors in `scripts/chatmemo-hook-setup.mjs` and re-run `setup:sync`.

### Memory not showing in chat

Memory is injected at **chat start**. Open a **new chat** after importing. Verify the summary exists in Memory History (clock icon in sidebar).

### ChatGPT import shows wrong dates / 0 conversations

The 2025 ChatGPT export format dropped `children` arrays from mapping nodes. The importer uses parent-link traversal from `current_node` — if it returns 0, the file may be malformed. Check that each conversation object has a `mapping` key and a valid `current_node`.

### Lessons document not updating

The lessons update runs after the session summariser. Ensure the chat has at least 4 messages and the OpenRouter API key is valid. Check server logs for `[summarize] Lessons update failed:`. The lessons update is non-fatal — a failure here does not affect the session summary.

### Claude Code hook not firing (VS Code)

Check that the hook is registered:

```bash
cat ~/.claude/settings.json
```

Look for an entry with `sync-to-chatmemo.mjs`. If missing, re-run `npm run setup:sync`.

### Claude Code macOS app sessions not syncing

The macOS app uses the background daemon, not the Stop hook. Check it is running:

```bash
launchctl list | grep chatmemo   # should show a PID
tail -f ~/.chatmemo/watch.log
```

If missing, reinstall: `npm run watch:claude:install` then `launchctl load ~/Library/LaunchAgents/com.chatmemo.watch-claude-sessions.plist`.

### `import:claude` stops with LLM timeouts

The free OpenRouter model is rate-limited. The script automatically retries on the next run (LLM failures are not marked as done). Re-run `npm run import:claude` after a few minutes. Increasing `DELAY_BETWEEN_CALLS_MS` in `scripts/import-claude-sessions.mjs` also helps.

### Perplexity import shows today's date for all conversations

Perplexity exports use Unix timestamps (seconds), not ISO strings, and only at the entry level — not the conversation level. The parser handles this automatically. If dates still appear wrong, the export file may use an unexpected format. Check that `entry.created_at` is a numeric Unix timestamp in the 1–10 billion range.

### Perplexity "✕ Perplexity" clear only removes some rows

Only rows imported after source tagging was introduced carry the `[source:perplexity]` prefix or the `Source: Perplexity /` line. Legacy rows from the very first import (stored via `buildRawRows` without any marker) cannot be selectively deleted — use **Clear all** and reimport all sources if a full reset is needed.

### Claude Code sessions showing as "Claude"

Claude Code sessions have their own source, `claude_code` (migration `20261001000000_summaries_claude_code_source.sql`). Sessions the laptop sync stored before that are indistinguishable from a Claude.ai import by content, so the migration cannot move them. `node scripts/backfill-claude-code-source.mjs` reports which rows it can identify — by the row ids in `~/.chatmemo/imported-sessions.json`, and by project-name titles — and changes nothing until run with `--apply` (add `--by-title` for the second group). It only sets the `source` column.

### Incremental import not picking up new conversations

Each source stores a watermark row `[chatmemo:watermark:source=X ts=N]` in the summaries table. If the watermark gets corrupted or points to a future timestamp, new conversations will be skipped. Fix: run **✕ Source** (clear that source) then reimport — this deletes the watermark and starts fresh.

### Timeline shows no Perplexity entries after import

The timeline parser skips watermark rows and date-index rows automatically. Perplexity entries require either the `[source:perplexity]` prefix or `Source: Perplexity /` text in the content body. If entries still don't appear, check the Memory History panel to confirm the rows were inserted, then reload the timeline.

### Ollama models do not appear in the Local tab

Confirm that `NEXT_PUBLIC_OLLAMA_URL` is present when Next.js starts and that `curl http://localhost:11434/api/tags` returns the downloaded models. Restart `npm run dev` after changing `.env.local`. If ChatMemo is opened from a different origin, inspect the browser console for an Ollama CORS or private-network error; prefer running ChatMemo on `http://localhost:3000` rather than exposing Ollama beyond loopback.

---

## 11. Security Notes

- **`SUPABASE_SERVICE_ROLE_KEY`** bypasses all Row Level Security policies. Never expose it client-side or commit it to git.
- **`CHATMEMO_IMPORT_TOKEN`** grants write access to your summaries table without a session. Treat it as a password. Rotate it by generating a new value, updating `.env.local`, and re-running `npm run setup:sync`.
- `.env.local` is gitignored. Verify with `git check-ignore -v .env.local`.
- The bookmarklet URL contains the import token in plain text. Do not share your bookmarks export.
- CORS on `/api/import/conversation` allows `https://claude.ai` and `http://localhost:3000`. Update `ALLOWED_ORIGINS` in the route if you deploy to a custom domain.
- Never expose Ollama's port `11434` publicly. Local-model inference is intentionally browser-to-loopback and never passes through the public server; chat history is still stored in Supabase normally.
- Remote custom-model and tool endpoints are restricted to public HTTPS destinations. Loopback, private-network, DNS-rebinding, cross-origin redirect, oversized-response, and credential-bearing shared configurations are rejected.
- Treat a tool's URL and OpenAPI schema as public when sharing it. Keep tools private if they need headers, authentication schemes, query credentials, webhook secrets, or embedded tokens.
- Keep deployments coordinated with migrations: publish the session/RLS-aware routes before or together with their policies, and never roll back to routes that use `service_role` for custom models or file retrieval.

---

## 12. Backup & Restore

ChatMemo has two complementary backup strategies. Use both for full coverage.

---

### 12.1 In-App Export (recommended for summaries data)

The Memory History panel has a built-in **Export all** button that downloads one JSON backup file per source. This requires no database credentials and produces files that can be re-uploaded through the same panel.

**To export:**

1. Open the Memory History panel (clock icon in the sidebar).
2. Scroll to the bottom — **Backup & Restore** section.
3. Click **Export all**.
4. The browser downloads up to four files (only sources with rows are downloaded):
   - `chatmemo-backup-claude-YYYY-MM-DD.json` — Claude Code sessions, bookmarklet imports, legacy bulk imports
   - `chatmemo-backup-chatgpt-YYYY-MM-DD.json` — ChatGPT bulk imports
   - `chatmemo-backup-perplexity-YYYY-MM-DD.json` — Perplexity bulk imports
   - `chatmemo-backup-other-YYYY-MM-DD.json` — VS Code sync-hook entries, in-app chat summaries

**To restore:**

1. Open Memory History → Backup & Restore.
2. Click **Restore backup**.
3. Select one backup file (repeat for each source file).
4. The restore endpoint compares content hashes and skips any row that already exists — safe to run multiple times or across partial restores.

**What is included:** every row in the `summaries` table — conversation summaries, date-index rows, and watermark rows. Restoring watermarks is correct: they prevent re-importing conversations that are already restored.

**What is NOT included:** profiles, chat sessions, messages, lessons. These are stored in separate tables and are not part of the summaries backup.

---

### 12.2 Nightly pg_dump backup (summaries + lessons)

A launchd job dumps every row of `summaries` and `user_lessons` at 03:00 into
`~/backups/chatmemo/chatmemo-YYYY-MM-DD.dump` (pg_dump custom format: compressed, mode 600;
pruned once older than 30 days). The job runs `scripts/backup-chatmemo.sh` straight from the
chatmemo checkout, like the session watcher.

How it is locked down:

- It logs in as **`chatmemo_backup`**, whose only table privilege is `SELECT` on those two
  tables (`supabase/migrations/20261007000000_backup_readonly_role.sql`). The laptop holds no
  key that can write to any table. (Like every role it can call functions granted to
  `PUBLIC`; revoking those is audit item M5.)
- The role's password lives only in `~/.pgpass` (mode 600). The database keeps a SCRAM hash.
- It connects through the Supabase **session pooler** with TLS (`sslmode=require`). The
  direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from the Mac.
- A failed run posts a macOS notification and writes the reason to
  `~/backups/chatmemo/backup.err`. A dump that `pg_restore` cannot list counts as a failure,
  and a failed run never overwrites a good dump (it writes to `.in-progress.dump` first).
- After each verified dump it updates a secret gist with the time and size (no memory data),
  using the `gh` login. Hermes's incident sweep reads it hourly and posts to the Incidents
  topic when it is ~50h old — the one alarm that also fires when the job never runs at all.
  A failed update is logged to `backup.err` and does not fail the backup;
  `CHATMEMO_BACKUP_HEARTBEAT_GIST=""` turns it off.

#### Setup (once)

1. `brew install libpq` — `pg_dump`/`pg_restore`; the script puts
   `/opt/homebrew/opt/libpq/bin` on its own `PATH`.
2. Apply the migration: `npm run db-push`.
3. From the chatmemo root: `node scripts/backup-setup.mjs`. It stores a fresh random password
   in `~/.pgpass` and prints one statement,
   `ALTER ROLE chatmemo_backup WITH PASSWORD 'SCRAM-SHA-256$4096:…';`. Run it in
   **Supabase → SQL editor**. It carries only the hash, so the password never leaves the
   laptop. Run both again to rotate the password.
4. Create `~/Library/LaunchAgents/com.chatmemo.backup.plist` (absolute paths; `<checkout>` is
   the chatmemo folder, `<home>` your home directory):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.chatmemo.backup</string>
     <key>ProgramArguments</key>
     <array>
       <string>/bin/bash</string>
       <string><checkout>/scripts/backup-chatmemo.sh</string>
     </array>
     <key>StartCalendarInterval</key>
     <dict>
       <key>Hour</key>
       <integer>3</integer>
       <key>Minute</key>
       <integer>0</integer>
     </dict>
     <key>StandardOutPath</key>
     <string><home>/backups/chatmemo/backup.log</string>
     <key>StandardErrorPath</key>
     <string><home>/backups/chatmemo/backup.err</string>
   </dict>
   </plist>
   ```

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.chatmemo.backup.plist
   ```

   After editing the plist: `launchctl bootout gui/$(id -u)/com.chatmemo.backup`, then
   `bootstrap` again. A Mac asleep at 03:00 runs the job when it wakes.

5. Run it now and read the result:

   ```bash
   launchctl kickstart gui/$(id -u)/com.chatmemo.backup
   tail -1 ~/backups/chatmemo/backup.log   # … backup ok: …/chatmemo-YYYY-MM-DD.dump (…)
   ```

Check what the role can do (SQL editor) — expect `SELECT` on the two tables and nothing else:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'chatmemo_backup';
```

Overrides (environment): `CHATMEMO_BACKUP_HOST`, `_PORT`, `_USER`, `_DIR`, and
`CHATMEMO_BACKUP_KEEP_DAYS` (`0` keeps every dump). The pooler host is regional (this
project: `aws-1-ap-northeast-2.pooler.supabase.com`); if the project moves region, change the
default in both scripts.

---

### 12.3 Restoring from a pg_dump backup

See what a dump holds:

```bash
pg_restore --list ~/backups/chatmemo/chatmemo-YYYY-MM-DD.dump
```

Restore into **empty** tables (a new project after `db-push`, or a cleared table) with an
admin connection — **Supabase → Connect → Session pooler** gives the string; it asks for the
database password:

```bash
pg_restore --data-only --no-owner --no-privileges \
  --dbname="postgresql://postgres.<ref>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  ~/backups/chatmemo/chatmemo-YYYY-MM-DD.dump
```

Add `--table=summaries` or `--table=user_lessons` to restore one table. Production runs
Postgres 17. Restoring into Postgres 15 (the local stack, `supabase/config.toml`) with
`pg_restore` 18 reports one ignorable error (`unrecognized configuration parameter
"transaction_timeout"`); the rows still load.

> **Caution:** a pg_dump restore does not deduplicate (the in-app restore does). Into a table
> that already has rows it stops at the first duplicate id and loads nothing from that table.
> To merge into live data, use the in-app restore (12.1).

---

### 12.4 Which strategy to use

| Situation                                        | Use                                |
| ------------------------------------------------ | ---------------------------------- |
| Back up memory data, want to restore via UI      | In-app Export all (section 12.1)   |
| Scheduled automated daily backup                 | pg_dump via launchd (section 12.2) |
| Migrate to a new Supabase project                | pg_dump → pg_restore (12.3)        |
| Accidentally cleared a source, want to re-import | In-app Restore backup              |
| Supabase Pro plan                                | Built-in PITR (no setup needed)    |

The in-app export is the fastest way to recover from an accidental **Clear all** or source clear. The pg_dump job is the safety net for hardware failure or database corruption.
