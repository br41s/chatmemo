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
12. [Backup & Restore](#12-backup--restore)

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
│  /api/import/perplexity    ← bulk Perplexity export │
│  /api/import/clear-source  ← selective source clear │
│  /api/import/restore       ← restore from backup    │
│  /api/export/summaries     ← export grouped by src  │
│  /api/memory/summarize     ← auto-summarise + lessons│
│  /api/chat/openrouter      ← chat completions       │
│  /api/timeline             ← conversation timeline  │
│                                                     │
│  lib/server/openrouter.ts       ← shared LLM helpers│
│  lib/server/get-latest-summary.ts ← memory inject  │
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

**Claude Code scripts** (run outside the Next.js server, talk to Supabase/OpenRouter directly):

| Script | Purpose |
|---|---|
| `scripts/sync-to-chatmemo.mjs` | Stop hook — fires after every VS Code turn |
| `scripts/import-claude-sessions.mjs` | One-shot bulk import of all past sessions |
| `scripts/watch-claude-sessions.mjs` | Background daemon for macOS app auto-sync |
| `scripts/claude-sessions-shared.mjs` | Shared utilities for the above three |

All scripts use `~/.chatmemo/config.json` (written by `setup:sync`) and track imported sessions in `~/.chatmemo/imported-sessions.json`.

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
NEXT_PUBLIC_USER_FILE_SIZE_LIMIT=10485760  # 10 MB (chat file attachments)
# Note: import routes (ChatGPT/Claude) have their own 100 MB limit in code

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
| `summaries` | Memory rows. Append-only. Includes raw conversation excerpts, LLM summaries, and date-index rows. |
| `user_lessons` | Self-improving knowledge doc. One row per user, upserted after each session. |
| `profiles` | User profile (display name, API keys, settings). |
| `chats` | Chat sessions. |
| `messages` | Individual messages within a chat. |

### `user_lessons` migration

The `supabase db push` CLI command is blocked by a pre-existing policy conflict in an older migration. Run this SQL **once** manually in the Supabase dashboard SQL editor:

```sql
CREATE TABLE IF NOT EXISTS user_lessons (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     text        NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT  user_lessons_user_id_key UNIQUE (user_id)
);
ALTER TABLE user_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own lessons"   ON user_lessons FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own lessons" ON user_lessons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own lessons" ON user_lessons FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own lessons" ON user_lessons FOR DELETE USING (auth.uid() = user_id);
```

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

### Claude Code Hook (VS Code)

The Stop hook fires automatically after every Claude Code turn in VS Code. It:
- Reads the JSONL transcript from `~/.claude/projects/<slug>/<session-id>.jsonl`.
- Requires at least 3 user messages before importing.
- Tracks imported session IDs in `~/.chatmemo/imported-sessions.json` to avoid duplicates.
- Calls OpenRouter and Supabase directly — no HTTP to the ChatMemo server.

To verify the hook is registered:

```bash
cat ~/.claude/settings.json | grep sync-to-chatmemo
```

### Claude Code Bulk Import

To import all historical sessions from `~/.claude/projects/` in one shot:

```bash
npm run import:claude
```

Shows per-session progress. Safe to interrupt and re-run — already-imported sessions are skipped. LLM failures are not marked as done, so they retry automatically on the next run.

### Claude Code Background Daemon (macOS app)

The macOS Claude Code app does not fire the Stop hook. A background daemon handles auto-sync:

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

## 8. Switching the Summarisation Model

There are two separate model constants to update:

**Server routes** — defined in `lib/server/openrouter.ts`:
```typescript
export const SUMMARIZE_MODEL = "meta-llama/llama-3.3-70b-instruct:free"
```

**Claude Code scripts** — defined in `scripts/claude-sessions-shared.mjs`:
```javascript
export const SUMMARIZE_MODEL = "meta-llama/llama-3.3-70b-instruct:free"
```

**To change the model**, update both constants and restart the server + daemon.

### Recommended free models on OpenRouter

| Model | Speed | Quality | Notes |
|---|---|---|---|
| `meta-llama/llama-3.3-70b-instruct:free` | fast | high | Current default |
| `google/gemini-2.5-flash-preview:free` | fast | good | Good alternative |
| `openai/gpt-oss-120b:free` | medium | high | Can be slow under load |

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

### Incremental import not picking up new conversations
Each source stores a watermark row `[chatmemo:watermark:source=X ts=N]` in the summaries table. If the watermark gets corrupted or points to a future timestamp, new conversations will be skipped. Fix: run **✕ Source** (clear that source) then reimport — this deletes the watermark and starts fresh.

### Timeline shows no Perplexity entries after import
The timeline parser skips watermark rows and date-index rows automatically. Perplexity entries require either the `[source:perplexity]` prefix or `Source: Perplexity /` text in the content body. If entries still don't appear, check the Memory History panel to confirm the rows were inserted, then reload the timeline.

---

## 11. Security Notes

- **`SUPABASE_SERVICE_ROLE_KEY`** bypasses all Row Level Security policies. Never expose it client-side or commit it to git.
- **`CHATMEMO_IMPORT_TOKEN`** grants write access to your summaries table without a session. Treat it as a password. Rotate it by generating a new value, updating `.env.local`, and re-running `npm run setup:sync`.
- `.env.local` is gitignored. Verify with `git check-ignore -v .env.local`.
- The bookmarklet URL contains the import token in plain text. Do not share your bookmarks export.
- CORS on `/api/import/conversation` allows `https://claude.ai` and `http://localhost:3000`. Update `ALLOWED_ORIGINS` in the route if you deploy to a custom domain.

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

### 12.2 Automated pg_dump Backup (full database, free tier)

For a complete database backup (all tables, all users) scheduled to run daily, use `pg_dump` via a macOS `launchd` job.

#### Step 1 — Find your Supabase database password

> You do not create this password; Supabase sets it when you create the project.

1. Go to **Supabase dashboard → Project Settings → Database**.
2. Scroll to **"Database password"** and copy it (or click **Reset** to generate a new one).
3. Also copy the **"Host"** value from the Connection string section — it looks like `db.abcdefghijkl.supabase.co`.

#### Step 2 — Store the password in `~/.pgpass` (never in the script)

`~/.pgpass` is a standard PostgreSQL file that `pg_dump` reads automatically. It must be readable only by your user.

```bash
# Create or append to ~/.pgpass
echo "db.YOUR-PROJECT-REF.supabase.co:5432:postgres:postgres:YOUR-DB-PASSWORD" >> ~/.pgpass

# Lock permissions — pg_dump refuses to use the file if it's world-readable
chmod 600 ~/.pgpass
```

Verify:
```bash
cat ~/.pgpass
# Should print: db.YOUR-PROJECT-REF.supabase.co:5432:postgres:postgres:YOUR-DB-PASSWORD
```

The password is now stored securely. **The backup script never contains the password.**

#### Step 3 — Install `pg_dump`

```bash
brew install libpq
echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify
pg_dump --version
```

#### Step 4 — Create the backup script

Create `~/scripts/backup-chatmemo.sh`:

```bash
#!/bin/bash
set -euo pipefail

DATE=$(date +%Y-%m-%d)
BACKUP_DIR="$HOME/backups/chatmemo"
mkdir -p "$BACKUP_DIR"

# Connection string — NO password here; pg_dump reads it from ~/.pgpass
DB_URL="postgresql://postgres@db.YOUR-PROJECT-REF.supabase.co:5432/postgres"

echo "[$(date)] Starting backup..."

# Back up only the summaries and user_lessons tables (the memory data)
pg_dump "$DB_URL" \
  --table=summaries \
  --table=user_lessons \
  --data-only \
  --no-owner \
  --no-privileges \
  -f "$BACKUP_DIR/chatmemo-$DATE.sql"

echo "[$(date)] Backup written to $BACKUP_DIR/chatmemo-$DATE.sql"

# Keep only last 30 days
find "$BACKUP_DIR" -name "chatmemo-*.sql" -mtime +30 -delete
echo "[$(date)] Old backups pruned."
```

```bash
chmod +x ~/scripts/backup-chatmemo.sh
```

Replace `YOUR-PROJECT-REF` with your actual Supabase project reference (the subdomain part of your Supabase URL).

#### Step 5 — Test it manually

```bash
~/scripts/backup-chatmemo.sh
```

Expected output:
```
[2026-05-28 03:00:00] Starting backup...
[2026-05-28 03:00:02] Backup written to /Users/brais/backups/chatmemo/chatmemo-2026-05-28.sql
[2026-05-28 03:00:02] Old backups pruned.
```

Inspect the file:
```bash
head -20 ~/backups/chatmemo/chatmemo-2026-05-28.sql
# Should show SQL INSERT statements for summaries rows
```

#### Step 6 — Schedule with launchd (runs at 3 AM daily)

Create `~/Library/LaunchAgents/com.chatmemo.backup.plist`:

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
    <string>/Users/brais/scripts/backup-chatmemo.sh</string>
  </array>

  <!-- Run at 03:00 every day -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <!-- Logs -->
  <key>StandardOutPath</key>
  <string>/Users/brais/backups/chatmemo/backup.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/brais/backups/chatmemo/backup.err</string>

  <!-- Start on login, respawn if it crashes -->
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.chatmemo.backup.plist
```

Verify it is scheduled:
```bash
launchctl list | grep chatmemo
# Should print a line with com.chatmemo.backup
```

#### Managing the launchd job

```bash
# Reload after editing the plist
launchctl unload ~/Library/LaunchAgents/com.chatmemo.backup.plist
launchctl load   ~/Library/LaunchAgents/com.chatmemo.backup.plist

# Run it right now (for testing)
launchctl start com.chatmemo.backup

# Disable permanently
launchctl unload ~/Library/LaunchAgents/com.chatmemo.backup.plist
```

---

### 12.3 Restoring from a pg_dump backup

```bash
psql "postgresql://postgres@db.YOUR-PROJECT-REF.supabase.co:5432/postgres" \
  -f ~/backups/chatmemo/chatmemo-2026-05-28.sql
```

`psql` also reads `~/.pgpass` automatically — no password in the command.

> **Caution:** restoring from a pg_dump `.sql` file inserts rows without checking for duplicates (unlike the in-app restore). If the table already has data, run the restore on a freshly-cleared table or filter the SQL file first.

---

### 12.4 Which strategy to use

| Situation | Use |
|---|---|
| Back up memory data, want to restore via UI | In-app Export all (section 12.1) |
| Scheduled automated daily backup | pg_dump via launchd (section 12.2) |
| Migrate to a new Supabase project | pg_dump → psql restore |
| Accidentally cleared a source, want to re-import | In-app Restore backup |
| Supabase Pro plan | Built-in PITR (no setup needed) |

The in-app export is the fastest way to recover from an accidental **Clear all** or source clear. The pg_dump job is the safety net for hardware failure or database corruption.
