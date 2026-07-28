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
- **Multi-provider chat** — OpenAI, Anthropic, Gemini, Mistral, Groq, Perplexity, OpenRouter, remote OpenAI-compatible endpoints, and local Ollama models running on your Mac

---

## Quick start (local)

### 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| Supabase account | free tier |
| OpenRouter account | free tier |
| Ollama | optional, for local models |

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

# Optional — models running locally through Ollama
NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434

# Set automatically by npm run setup:sync
CHATMEMO_IMPORT_TOKEN=
CHATMEMO_IMPORT_USER_ID=
```

Find your Supabase keys at **Supabase dashboard → Project Settings → API**.

### 4. Set up the database

Link the CLI to your project and apply the versioned migrations:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db-push
npm run db-types-remote
```

Do not paste migrations individually or mark them as applied without first auditing the remote schema. The migration history is part of ChatMemo's security boundary.

See the [Admin Guide](docs/ADMIN_GUIDE.md#5-database-setup) for the full step-by-step.

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and your account is ready.

### 6. Run a local model with Ollama (optional)

Install [Ollama](https://ollama.com/download), start it, and download a model:

```bash
ollama pull llama3.2:3b
ollama list
```

Keep `NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434` in `.env.local`, restart ChatMemo, and choose the model from the **Local** tab in the model selector. Model discovery and inference go directly from your browser to Ollama instead of through the ChatMemo server. ChatMemo still saves chat messages and generated memories to Supabase through its normal authenticated flow.

This flow is designed for ChatMemo opened locally on the same Mac. A public Vercel deployment cannot use its server to reach your Mac's `localhost`.

### 7. Set up memory sync (bookmarklet + Claude Code hook)

```bash
npm run setup:sync
```

This wires up the Claude Code Stop hook, writes your user ID to `.env.local`, and prints the bookmarklet URL to add to your browser. Run it once after signup.

---

## Documentation

| Guide | Audience |
|---|---|
| [User Guide](docs/USER_GUIDE.md) | Day-to-day usage — importing, memory, models, tools, timeline |
| [Admin Guide](docs/ADMIN_GUIDE.md) | Installation, local models, database, security, sync, backup |

---

## Tech stack

- **Frontend / API**: Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui
- **Database / Auth**: Supabase (Postgres + Row Level Security)
- **LLM routing**: OpenRouter (summarisation), multi-provider chat, browser-to-Ollama local chat
- **Deployment**: Vercel (recommended) or any Node.js host

---

## Updating

```bash
npm run update   # git pull + apply pending migrations + regenerate types
```

---

## License

MIT — forked from [mckaywrigley/chatbot-ui](https://github.com/mckaywrigley/chatbot-ui).
