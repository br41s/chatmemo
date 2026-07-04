# ChatMemo — Claude Code Instructions

Self-hosted AI chat platform forked from Chatbot UI (mckaywrigley), extended
with a persistent cross-provider memory system. Deployed on Vercel
(https://chatmemo-one.vercel.app), Supabase for Postgres/Auth/Storage.

## Session start

1. Read this file.
2. Check `memories/decisions.md` and `memories/errors.md` at the workspace
   level (`/Users/brais/VSCODE/memories/`) for recent ChatMemo entries.

## Stack

Next.js 14 App Router + TypeScript + Supabase + Tailwind + shadcn/ui.
Chat providers: OpenAI, Anthropic, Google, Mistral, Groq, Perplexity, Azure,
OpenRouter, Ollama, custom endpoints — one route each under `app/api/chat/`.

## Architecture — memory system (the core feature)

- `summaries` table: append-only memory rows (in-app chat summaries, Claude
  Code sessions, bulk imports from ChatGPT/Claude/Perplexity/Gemini).
- `lib/server/inject-memory.ts`: shared injector — every provider chat route
  prepends the user's memory block to the system prompt. Three layers run in
  parallel per turn:
  1. baseline blob (`get-latest-summary.ts`) — lessons + personal rows +
     truncated bulk rows, ~100k char budget;
  2. always-on relevance (`get-relevant-memory.ts`) — ILIKE search over all
     summaries by topic words of the latest message;
  3. trigger-gated full retrieval (`get-full-conversation.ts`) — verbatim
     transcripts when the user asks to recover a conversation.
- `lib/server/streaming.ts`: local text-stream helpers used by all chat
  routes (replaced the legacy `ai@2.x` package — do not reintroduce it).
- All LLM summarization goes through OpenRouter (`lib/server/openrouter.ts`),
  free model with paid fallback.

## Commands

- `npm run chat` — local Supabase + types + dev server
- `npm run type-check` / `npx jest` / `npm run build` — the CI gate; run all
  three before declaring any change done
- `npm run db-migrate` / `db-push` — apply migrations locally / to prod

## Constraints & gotchas

- **Pre-commit hook runs `git add .`** (`.husky/pre-commit`). For atomic
  commits: run `lint:fix`/`format:write` manually, commit with `--no-verify`.
- **`next build` deletes/regenerates `public/worker-*.js`** (next-pwa). Two
  legacy worker files are tracked; restore with `git checkout --` if a local
  build removes them. New ones are gitignored.
- **`d3-dsv` looks unused but is required** — runtime peer dependency of
  LangChain's `CSVLoader` (CSV uploads break without it, no compile error).
- Routes must never break chat on memory failure: memory retrieval errors are
  caught and degrade to no-memory (see `fetchMemoryBlock`).
- Never commit `.env.local`; bearer-token import auth is configured by
  `npm run setup:sync`.

## Verification

- Unit tests cover the memory transforms, ranking, term-gating, and streaming
  helpers (`__tests__/lib/`). Add a test when touching any of those.
- CI (`.github/workflows/ci.yml`) runs type-check + jest + production build
  on every push to main and on PRs.
