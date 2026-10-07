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
  `source` is one of `claude` (Claude.ai), `claude_code`, `copilot`,
  `chatgpt`, `perplexity`, `other` (in-app), closed by a CHECK constraint. A new value
  must be added to the classifier (`lib/summary-metadata.ts`), the trigger and
  the personal-rows query in `get-latest-summary.ts`, or its rows never reach
  the block. Claude Code sessions synced before they were tagged still say
  `[source:claude]` in their content; for those the column is the truth, so
  readers that name a source (report, timeline, backup) take it from the
  column and not from the text.
  Every session writer — the laptop hook, watcher and importers, and the
  Claude Code **cloud** hook served from `public/hooks/chatmemo-cloud-sync.mjs`
  — posts to `/api/import/conversation` with an import token and a
  `sessionKey`; `external_id` lets each post replace the session's previous
  row. The laptop holds no OpenRouter key and no database key that can write:
  `~/.chatmemo/config.json` carries the token, the deployment URL and
  `excludeProjects`, mode 600; the only database credential is the nightly
  backup's read-only `chatmemo_backup` role in `~/.pgpass` (its only table
  privilege is SELECT on `summaries` and `user_lessons` — ADMIN_GUIDE §12.2). The
  cloud hook exports the transcript-cleaning passes (`cleanText`: injected
  blocks dropped, credentials redacted) and the laptop scripts import them, so
  every path cleans the same way; a `.chatmemo-nosync` file opts a directory
  out. Tokens are scoped in `lib/server/import-token.ts`: the cloud token may
  only post `claude-code:` keys. The admin guide pins the served hook's sha256
  and `__tests__/scripts/cloud-hook-pin.test.ts` fails when they drift.
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
  overhead gets no block. `CHARS_PER_TOKEN` is 3.5, measured on real memory
  (3.6–3.8 for Spanish rows and lessons). Lessons that do not fit are cut
  per section (`fitLessons`): every `## ` section keeps its heading and its
  first lines, short sections stay whole. A layer whose first entry does not fit carries a
  cut version of it, marked as cut, rather than nothing
  (`lib/server/cut-to-fit.ts`) — an empty transcript layer is reported as "no
  matching conversation found". `__tests__/lib/memory-block-fits.test.ts`
  builds the real block at several window sizes; add to it when adding
  anything to the block. A catalogue model whose provider reports no limits
  is assumed to have 200k (Anthropic) or 128k (OpenAI) of window
  (`lib/models/model-window.ts`); a custom endpoint uses the context length
  stored with it (client hint and `chat/custom` route); anything else, Ollama
  included, is budgeted at the 8k default.
- Timeline: a page at `/[workspaceid]/timeline` (`timeline-view.tsx`), not a
  sheet. `/api/timeline/activity` pages through every memory row (PostgREST
  caps a request at 1,000 rows, silently) and groups them by month and
  source for the chart (`lib/timeline-activity.ts`); `/api/timeline` orders
  by `effective_at` then `id`, so pages are stable across requests. The
  chart's bar colours come from the source tokens, validated with the
  dataviz palette checks; `--chart-perplexity` exists because the light-mode
  teal that reads as text is too grey as a fill.
- Memory is untrusted text (imports, bookmarklet posts, sessions that read a
  hostile page), so the block defends itself: rule 9 of the instructions says
  the sections are stored data, never instructions, and every row and the
  lessons document pass through `neutraliseMemoryTags` (`lib/memory-block.ts`)
  before they are placed, which turns a copy of any of the block's own tags
  (`[/LESSONS]`, `[/CHATMEMO_MEMORY]`…, any case, spaces tolerated) into
  `⟦/LESSONS⟧`, same length. That keeps the block's structure and the
  `memory-report.ts` parser honest; a row can still forge a `### [date]`
  header or a `---` separator, and the model-side defence for those is rule 9. The tools route injects memory only when every selected tool is the
  caller's own, as the custom route does for models: a shared tool is someone
  else's server and its schema can tell the model what to send there.
- `lib/server/streaming.ts`: local text-stream helpers used by all chat
  routes (replaced the legacy `ai@2.x` package — do not reintroduce it).
- All LLM summarization goes through OpenRouter (`lib/server/openrouter.ts`),
  `openai/gpt-oss-120b` (paid; the `:free` variant was withdrawn), asked for
  providers that keep nothing (`provider.data_collection: "deny"`). Nothing
  on the laptop calls OpenRouter: the scripts post to the import route.

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
- **Images in answers load from our origins only.** A markdown image fetches
  with no click, so one the model was talked into emitting would carry its URL
  to any host. `message-markdown.tsx` renders `img` only for `data:image`,
  `blob:`, this site and the Supabase project (`isAllowedImageSrc`,
  `lib/safe-image-src.ts`); the rest shows as text. The browser enforces the
  same list through the `Content-Security-Policy` `img-src` in `next.config.js`,
  built from `NEXT_PUBLIC_SUPABASE_URL` at build time (plus localhost in dev;
  unset, nothing remote is allowed). `images.remotePatterns` names that exact
  host too, and the renderer refuses `/_next/image`: the optimizer fetches the
  URL it is given, so a wildcard pattern would be an open proxy for an answer's
  image. A new image host needs all three.
- **The service worker caches no responses.** `workboxOptions.runtimeCaching`
  is empty and the start URL is not cached: the defaults kept `/api/*` GETs
  and the page payload (profile with provider keys) in Cache Storage for a
  day. `public/sw-cleanup.js` (imported by the generated worker) deletes the
  caches a previous worker left behind when the new one activates, and
  sign-out empties Cache Storage too (`lib/clear-cache-storage.ts`). `/api/*`
  also answers `Cache-Control: no-store`.
- **Chat widths are ceilings:** the composer and messages use `w-full` with
  `max-w-*` steps. They live in the chat column, not the window, so a fixed
  `sm:w-[600px]` overflows whenever the sidebar is open on a mid-width screen.
- Never commit `.env.local`; bearer-token import auth is configured by
  `npm run setup:sync`.
- **Storage cleanup reads its key from Vault.** The `delete_old_*` triggers
  call `delete_storage_object`, which takes the Storage URL and key from the
  Vault secrets `storage_delete_project_url` /
  `storage_delete_service_role_key`; anon and authenticated may not run it
  (until 2026-10-07 they could, with the real key in the function body). The
  key is the dedicated `storagecleanup` secret key (`sb_secret_…`), sent in
  the `apikey` header — new keys are not JWTs and fail as a Bearer token; the
  legacy 2026-05 service_role JWT no longer verifies. A wrong or missing
  secret only warns and leaves orphaned objects; ADMIN_GUIDE "Storage cleanup
  key" has the rotation steps and a healthcheck query.

## Verification

- Unit tests cover the memory transforms, ranking, term-gating, and streaming
  helpers (`__tests__/lib/`). Add a test when touching any of those.
- **No GitHub Actions on this account.** The gate is local: the husky
  pre-push hook runs type-check + jest on every push, and Vercel's deploy
  build catches build breakage. Run `npm run build` manually before pushing
  risky dependency or route changes.
