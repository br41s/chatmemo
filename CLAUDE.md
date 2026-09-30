# ChatMemo — Claude Code Instructions

Self-hosted AI chat platform forked from Chatbot UI (mckaywrigley), extended
with a persistent cross-provider memory system. Deployed on Vercel
(https://chatmemo-one.vercel.app), Supabase for Postgres/Auth/Storage.

## Session start

Workspace `memories/decisions/chatmemo.md` holds this project's decision history.
Paths are workspace-relative — never hardcode an absolute home directory.

## Stack

Next.js 15 App Router + React 19 + TypeScript + Supabase + Tailwind + shadcn/ui.
Chat providers: OpenAI, Anthropic, Google, Mistral, Groq, Perplexity, Azure,
OpenRouter, Ollama, custom endpoints — one route each under `app/api/chat/`.

## Architecture — memory system (the core feature)

- `summaries` table: memory rows (in-app chat summaries, Claude Code
  sessions, bulk imports from ChatGPT/Claude/Perplexity/Gemini). Rows are
  written once rather than edited — there is no `updated_at` and no UPDATE
  policy — but they are deletable: the memory panel offers delete, clear-all
  and restore (`20260518000000_summaries_delete_policy`). Every memory read
  filters on the typed `kind` column; a trigger derives `kind`/`source`/
  `title`/`occurred_at` from `content` for writers that send content only
  (the Claude Code session scripts), so a row without them is never invisible.
  Claude Code **cloud** sessions never reach the laptop sync; a hook served
  from `public/hooks/chatmemo-cloud-sync.mjs` posts them from the container to
  `/api/import/conversation` with a `sessionKey`, and `external_id` lets each
  post replace the session's previous row.
- `lib/server/inject-memory.ts`: shared injector — every provider chat route,
  the tools route included, prepends the user's memory block to the system
  prompt. `custom` injects only for the user's own models (a shared model is
  someone else's endpoint). Ollama runs browser → localhost, so the browser
  fetches the block from `/api/memory/block` and prepends it with
  `lib/memory-block.ts`. Three layers run in
  parallel per turn:
  1. baseline blob (`get-latest-summary.ts`) — lessons + personal rows +
     truncated bulk rows, sized by the turn's context budget;
  2. always-on relevance (`get-relevant-memory.ts`) — ILIKE search over all
     summaries by topic words of the latest message;
  3. trigger-gated full retrieval (`get-full-conversation.ts`) — verbatim
     transcripts when the user asks to recover a conversation.
- `lib/memory-report.ts`: what a turn was told, sent back in the
  `x-chatmemo-memory` response header ahead of the stream — layer sizes,
  date spans and the matched entries' titles/sources (capped; dropped before
  the report itself if the header would exceed 4 KB). Entries are named from
  the rows the relevance layer returns (`RelevantMemory.entries`), never by
  splitting the joined block: stored conversations contain `---` themselves. The chat shows it
  while waiting for the first token (`memory-recalling.tsx`) and under the
  answer (`message-memory.tsx`). Source colours come from one record,
  `timeline-sources.tsx`, via `memory-source-chip.tsx`.
- `/api/memory/recall` (`recallPreviewFor` in `inject-memory.ts`): the
  report's headers only leave the server once the model starts answering, so
  the browser asks here, alongside the chat request, which conversations the
  turn is about to be reminded of. Same relevance search and budget hint, and
  the text is read from the built request with the injector's own extractor
  (`lastUserText*` in `lib/memory-block.ts`) — never from what was typed, which
  differs on Regenerate, with images, with retrieved file text and when a long
  message is trimmed away. Titles and sources only. On a recovery request it
  says a transcript search is under way rather than running that retrieval
  twice. Not fired for Ollama (real report arrives first), custom models (may
  get no memory) or the tools path. Costs one extra relevance search per turn.
- `lib/context-budget.ts`: one split of the model's window between reply,
  history and the memory block. Every part of the block has an allowance and
  they sum to `memoryChars`: a 6k overhead reserve (instructions, tags,
  separators), lessons (up to 30% of the rest, 32k at most) and the four
  layers in fixed proportions. On a large window the layers reach their
  previous sizes (80k personal, 20k bulk, 10k index, 6k relevant; 120k for a
  recovered transcript) and the ceiling is 154k. A window too small for the
  overhead gets no block. A layer whose first entry does not fit carries a
  cut version of it, marked as cut, rather than nothing
  (`lib/server/cut-to-fit.ts`) — an empty transcript layer is reported as "no
  matching conversation found". `__tests__/lib/memory-block-fits.test.ts`
  builds the real block at several window sizes; add to it when adding
  anything to the block. A model whose window is unknown is budgeted at 8k.
- `lib/server/streaming.ts`: local text-stream helpers used by all chat
  routes (replaced the legacy `ai@2.x` package — do not reintroduce it).
- All LLM summarization goes through OpenRouter (`lib/server/openrouter.ts`),
  `openai/gpt-oss-120b` (paid; the `:free` variant was withdrawn). The laptop
  scripts keep their own copy of the list in `scripts/claude-sessions-shared.mjs`.

## Commands

- `npm run chat` — local Supabase + types + dev server
- `npm run type-check` / `npx jest` / `npm run build` — the verification
  gate; run all three before declaring any change done
- `npm run db-migrate` / `db-push` — apply migrations locally / to prod

## Constraints & gotchas

- **Pre-commit runs `lint-staged`** — it formats only what is already
  staged, so partial commits work normally and `--no-verify` is no longer
  needed for them.
- **`next build` deletes/regenerates `public/worker-*.js`** (next-pwa). Two
  legacy worker files are tracked; restore with `git checkout --` if a local
  build removes them. New ones are gitignored.
- **`d3-dsv` looks unused but is required** — runtime peer dependency of
  LangChain's `CSVLoader` (CSV uploads break without it, no compile error).
- Routes must never break chat on memory failure: memory retrieval errors are
  caught and degrade to no-memory (see `fetchMemoryBlock`).
- **Route auth and errors:** a route that only needs the user calls
  `requireUser()` (`lib/server/require-user.ts`), which returns the 401 itself;
  `getServerProfile()` is for routes that need the stored API keys. Throw
  `HttpError` (`lib/server/http-error.ts`), or a subclass, for anything the
  user should read; routes answer it with its status and log the rest as 500.
- **Request APIs are async (Next 15):** `cookies()`, `headers()`, `params`
  and `searchParams` are Promises — `createClient(await cookies())`.
- **Tooltips on controls:** `WithTooltip` wraps its trigger in a `<button>` by
  default. Around something that is already a control (a button, a tab, a
  sheet or popover trigger) pass `interactive`, which uses a plain wrapper —
  otherwise it is a button inside a button, a hydration error and a second tab
  stop. Radix `*Trigger` around a `Button` needs `asChild` for the same reason.
- **Chat widths are ceilings:** the composer and messages use `w-full` with
  `max-w-*` steps. They live in the chat column, not the window, so a fixed
  `sm:w-[600px]` overflows whenever the sidebar is open on a mid-width screen.
- Never commit `.env.local`; bearer-token import auth is configured by
  `npm run setup:sync`.

## Verification

- Unit tests cover the memory transforms, ranking, term-gating, and streaming
  helpers (`__tests__/lib/`). Add a test when touching any of those.
- **No GitHub Actions on this account.** The gate is local: the husky
  pre-push hook runs type-check + jest on every push, and Vercel's deploy
  build catches build breakage. Run `npm run build` manually before pushing
  risky dependency or route changes.
