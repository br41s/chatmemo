# ChatMemo

**ChatMemo** is a self-hosted AI memory layer that captures your conversations from Claude.ai, Claude Code, ChatGPT, and Perplexity — turns them into durable summaries — and injects them into every new chat so the AI already knows who you are.

Built on [Chatbot UI](https://github.com/mckaywrigley/chatbot-ui) (Next.js 14 + Supabase), extended with a full memory and import pipeline.

---

## What it does

- **Persistent memory** — every chat starts with up to ~48 000 characters of context: a structured lessons document about you + recent conversation summaries
- **Full conversation recall** — ask (in English or Spanish) to recover a full past conversation by title or date and the AI pulls the complete untruncated transcript instead of the summary (in-app, Perplexity, and Claude imports)
- **Multi-source import** — Claude.ai (bookmarklet + bulk export), Claude Code sessions (VS Code hook + macOS daemon), ChatGPT export, Perplexity export
- **Self-improving lessons** — after each chat the AI reviews what it learned and updates a knowledge document about your projects, preferences, and patterns
- **Timeline** — browse all your conversations across all sources, merged by real date, with search and filtering
- **Multi-provider chat** — OpenAI, Anthropic, Gemini, Mistral, Groq, Perplexity, Ollama, OpenRouter

---

## Quick start (local)

### 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| Supabase account | free tier |
| OpenRouter account | free tier |

### 2. Clone and install

```bash
git clone https://github.com/braisntext/chatmemo.git
cd chatmemo
npm install
cp .env.local.example .env.local
```

### 3. Fill in `.env.local`

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# OpenRouter — used for all memory summarisation (required)
OPENROUTER_API_KEY=sk-or-v1-...

# Set automatically by npm run setup:sync
CHATMEMO_IMPORT_TOKEN=
CHATMEMO_IMPORT_USER_ID=
```

Find your Supabase keys at **Supabase dashboard → Project Settings → API**.

### 4. Set up the database

Run these SQL statements once in the **Supabase SQL editor** (dashboard → SQL editor):

```sql
-- Core schema: run the migration files in supabase/migrations/ in order,
-- OR paste them one by one into the SQL editor.
-- At minimum you need: 20240108234540_setup.sql (base schema)

-- Memory tables (required for ChatMemo features)
-- Run 20260517000000_add_summaries.sql
-- Run 20260518000000_summaries_delete_policy.sql
-- Run 20260519000000_user_lessons.sql
-- Run 20260520000000_perf_indexes.sql

-- If supabase db push is blocked by a policy conflict, apply migrations manually
-- in the SQL editor in the order shown above.
```

See the [Admin Guide](docs/ADMIN_GUIDE.md#5-database-setup) for the full step-by-step.

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and your account is ready.

### 6. Set up memory sync (bookmarklet + Claude Code hook)

```bash
npm run setup:sync
```

This wires up the Claude Code Stop hook, writes your user ID to `.env.local`, and prints the bookmarklet URL to add to your browser. Run it once after signup.

---

## Documentation

| Guide | Audience |
|---|---|
| [User Guide](docs/USER_GUIDE.md) | Day-to-day usage — importing, memory, timeline, lessons |
| [Admin Guide](docs/ADMIN_GUIDE.md) | Installation, env vars, DB setup, sync config, backup |

---

## Tech stack

- **Frontend / API**: Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui
- **Database / Auth**: Supabase (Postgres + Row Level Security)
- **LLM routing**: OpenRouter (summarisation), multi-provider chat
- **Deployment**: Vercel (recommended) or any Node.js host

---

## Updating

```bash
npm run update   # git pull + apply pending migrations + regenerate types
```

---

## License

MIT — forked from [mckaywrigley/chatbot-ui](https://github.com/mckaywrigley/chatbot-ui).
