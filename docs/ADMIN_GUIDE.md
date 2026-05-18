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
8. [Switching the Summarisation Model](#8-switching-the-summarisation-model)
9. [Upgrading](#9-upgrading)
10. [Troubleshooting](#10-troubleshooting)
11. [Security Notes](#11-security-notes)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│  ┌────────────┐   ┌──────────────────────────────┐  │
│  │ ChatMemo   │   │ claude.ai + bookmarklet       │  │
│  │ Next.js 14 │   │ (fires POST /api/import/…)   │  │
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
│  /api/memory/summarize     ← in-app auto-summarise  │
│  /api/chat/openrouter      ← chat completions       │
│                                                     │
│  lib/server/openrouter.ts  ← shared LLM helpers    │
└──────────────┬──────────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
  OpenRouter API    Supabase (Postgres + Auth)
  (summarisation)   (summaries, chats, messages)
```

**Claude Code hook** (`scripts/sync-to-chatmemo.mjs`):
- Registered as a Stop hook in `~/.claude/settings.json`.
- Fires after every Claude Code session turn.
- Reads the JSONL transcript, summarises via OpenRouter, inserts into Supabase directly (service role key, no HTTP to ChatMemo server).

---

## 2. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 or later |
| npm | 9 or later |
| Git | any recent |
| Supabase account | free tier sufficient |
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

# ── Bookmarklet auth token ★ (set by setup:sync) ────
# A random hex token embedded in the bookmarklet URL.
# The API accepts it as a Bearer token to bypass SameSite cookies.
CHATMEMO_IMPORT_TOKEN=<generate with: node -e "require('crypto').randomBytes(32,(_,b)=>console.log(b.toString('hex')))">
CHATMEMO_IMPORT_USER_ID=<set automatically by npm run setup:sync>

# ── File upload size limit (bytes) ──────────────────
NEXT_PUBLIC_USER_FILE_SIZE_LIMIT=10485760  # 10 MB

# ── Optional provider keys ──────────────────────────
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GEMINI_API_KEY=
```

### Supabase keys

Find them at **Supabase dashboard → Project Settings → API**.

- `NEXT_PUBLIC_SUPABASE_URL` — the project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key (safe to expose client-side).
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**. Never expose in client code. Used by the bookmarklet import endpoint and the sync hook to bypass Row Level Security.

---

## 5. Database Setup

ChatMemo uses Supabase migrations stored in `supabase/migrations/`.

```bash
# Local development (requires Supabase CLI)
supabase start
npm run db-migrate   # runs all pending migrations
npm run db-types     # regenerates TypeScript types from schema

# Remote (production)
npm run db-push      # pushes local migrations to remote Supabase
```

### Key tables

| Table | Purpose |
|---|---|
| `summaries` | Memory summaries. Each row is one LLM-generated block of text. |
| `profiles` | User profile (display name, API keys, settings). |
| `chats` | Chat sessions. |
| `messages` | Individual messages within a chat. |

### RLS policies on `summaries`

All operations are scoped to `auth.uid() = user_id`:

| Operation | Policy |
|---|---|
| SELECT | `user_id = auth.uid()` |
| INSERT | `user_id = auth.uid()` |
| DELETE | `user_id = auth.uid()` |

The **service role key** bypasses RLS — used by the bookmarklet import and the sync hook.

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

Run **once** after installation, and again if you change the `CHATMEMO_IMPORT_TOKEN` or sign up with a new account:

```bash
npm run setup:sync
```

This script:
1. Reads credentials from `.env.local`.
2. Fetches your Supabase user ID via the admin API.
3. Writes `CHATMEMO_IMPORT_USER_ID` to `.env.local`.
4. Writes `~/.chatmemo/config.json` (used by the Claude Code hook).
5. Registers the Stop hook in `~/.claude/settings.json`.
6. Prints the bookmarklet URL to add to your browser.

### Bookmarklet

Copy the printed URL and add it to your browser bookmarks bar (right-click → Add page → paste URL). Name it **Save to ChatMemo**.

The bookmarklet uses three fallback strategies to detect messages on claude.ai:

| Priority | Selector | Notes |
|---|---|---|
| 1 | `[data-message-author-role]` | Future-proof attribute |
| 2 | `[class*="font-user-message"]` + `[class*="font-claude-response"]` | Current claude.ai classes (May 2026) |
| 3 | `[class*="human-turn"]` etc. | Generic fallback |

If claude.ai changes its HTML structure, update the selector constants in `scripts/chatmemo-hook-setup.mjs` and re-run `npm run setup:sync`.

### Claude Code Hook

The Stop hook fires automatically after every Claude Code session. It:
- Reads the JSONL transcript from `~/.claude/projects/.../...jsonl`.
- Requires at least 3 user messages before importing.
- Tracks imported session IDs in `~/.chatmemo/imported-sessions.json` to avoid duplicates.
- Calls OpenRouter directly (no HTTP to the ChatMemo server) using the service role key.

To verify the hook is registered:

```bash
cat ~/.claude/settings.json | grep sync-to-chatmemo
```

---

## 8. Switching the Summarisation Model

All routes share a single model constant defined in **`lib/server/openrouter.ts`**:

```typescript
export const SUMMARIZE_MODEL = "openai/gpt-oss-120b:free"
```

The sync script mirrors this constant:

```javascript
// scripts/sync-to-chatmemo.mjs
const SUMMARIZE_MODEL = "openai/gpt-oss-120b:free"  // keep in sync with lib/server/openrouter.ts
```

**To change the model**, update both lines and restart the server.

### Recommended free models on OpenRouter

| Model | Speed | Quality | Rate limit |
|---|---|---|---|
| `openai/gpt-oss-120b:free` | medium | high | shared quota |
| `google/gemini-2.5-flash-preview:free` | fast | good | shared quota |
| `meta-llama/llama-3.3-70b-instruct:free` | slow (overloaded) | high | 8 rpm |

> **Note:** Free-tier models share a public quota. If you hit rate limits frequently, add credits to your OpenRouter account and remove the `:free` suffix from the model name.

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
document.querySelectorAll('[class*="font-user-message"],[class*="font-claude-response"]').length
```
If it returns 0, update the selectors in `scripts/chatmemo-hook-setup.mjs` and re-run `setup:sync`.

### Memory not showing in chat
Memory is injected at **chat start**. Open a **new chat** after importing. Verify the summary exists in Memory History (🧠 icon in sidebar).

### Claude Code hook not firing
Check that the hook is registered:
```bash
cat ~/.claude/settings.json
```
Look for an entry with `sync-to-chatmemo.mjs`. If missing, re-run `npm run setup:sync`.

---

## 11. Security Notes

- **`SUPABASE_SERVICE_ROLE_KEY`** bypasses all Row Level Security policies. Never expose it client-side or commit it to git.
- **`CHATMEMO_IMPORT_TOKEN`** grants write access to your summaries table without a session. Treat it as a password. Rotate it by generating a new value, updating `.env.local`, and re-running `npm run setup:sync`.
- `.env.local` is gitignored. Verify with `git check-ignore -v .env.local`.
- The bookmarklet URL contains the import token in plain text. Do not share your bookmarks export.
- CORS on `/api/import/conversation` allows `https://claude.ai` and `http://localhost:3000`. Update `ALLOWED_ORIGINS` in the route if you deploy to a custom domain.
