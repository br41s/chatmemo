import { createClient } from "@/lib/supabase/server"
import { getLessons } from "@/lib/db/lessons"
import { VersionedCache } from "@/lib/server/versioned-cache"
import { cookies } from "next/headers"

// ---------------------------------------------------------------------------
// Memory budget
//
// "Personal" rows are all Claude-origin content: Claude Code sessions,
// VS Code sync hook, bookmarklet entries, Claude bulk import LLM summaries,
// and in-app chat summaries. These are already compact (~400–1 500 chars).
//
// IMPORTANT: [source:claude] rows ARE personal rows. We only exclude
// [source:perplexity] and [source:chatgpt] from query A — NOT [source:claude].
// That was the root bug: Claude Code sessions were invisible to both queries.
//
// "Bulk" rows are Perplexity and ChatGPT imports. Raw conversations can be
// 10 k chars; we cap them at 400 chars for topic awareness. LLM summaries
// generated at import time (compact, <800 chars) are also stored with the
// same source tag and are fully included under the 400-char cap.
//
// Total injected: ~100 k chars ≈ 25 k tokens. Fast and safe for all models.
// ---------------------------------------------------------------------------

const PERSONAL_BUDGET = 80_000 // chars — ~60–80 sessions at 1 000 avg
const BULK_BUDGET = 20_000 // chars — ~50 Perplexity/ChatGPT topics

const PERSONAL_ROW_MAX = 1_500 // cap per personal row
const BULK_ROW_MAX = 400 // title + opening line only for bulk rows

const MAX_PERSONAL_ROWS = 150 // enough to cover all personal sessions
const MAX_BULK_ROWS = 30 // only recent bulk rows are useful
const MAX_INDEX_ROWS = 5

function cap(content: string, max: number): string {
  return content.length > max ? content.slice(0, max) + "…" : content
}

/**
 * Returns memory content to inject into the system prompt.
 *
 * Fetches the lessons document alongside three parallel row queries, then hands
 * everything to buildSummarySections. Lessons are a separate memory layer from
 * conversation history — either one alone is worth injecting.
 *
 * The three row queries:
 *   A. Personal rows — everything EXCEPT [source:perplexity], [source:chatgpt],
 *      watermarks, and index rows. This includes [source:claude] rows (Claude
 *      Code sessions, bookmarklet, bulk import LLM summaries) AND untagged
 *      rows (old in-app chat summaries). Limit 150, budget 80 k chars.
 *   B. Bulk rows — Perplexity + ChatGPT only. Raw text capped at 400 chars;
 *      LLM summaries (if present) also fit under 400 chars. Limit 30.
 *   C. Index rows — compact conversation date lists.
 */
// Keyed by user, versioned by the state of their memory. Module scope, so a
// warm server instance reuses it across requests; a cold one simply misses.
// Bounded because a shared instance must not grow with the number of users it
// happens to serve.
const baselineCache = new VersionedCache<string | null>(50)

/**
 * A token that changes whenever anything the baseline blob is built from
 * changes: a summary inserted, a summary deleted, or the lessons document
 * rewritten.
 *
 * Count matters as much as the newest timestamp — deleting an older row from
 * the memory panel leaves the newest one untouched, and versioning on the
 * timestamp alone would keep serving the deleted content. PostgREST returns
 * the exact count alongside the row, so this stays two small queries.
 */
async function readMemoryVersion(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const [summaries, lessons] = await Promise.all([
    supabase
      .from("summaries")
      .select("created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("user_lessons")
      .select("updated_at")
      .eq("user_id", userId)
      .maybeSingle()
  ])

  const newest = summaries.data?.[0]?.created_at ?? "none"
  const count = summaries.count ?? -1
  const lessonsAt = lessons.data?.updated_at ?? "none"

  return `${count}|${newest}|${lessonsAt}`
}

export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  const version = await readMemoryVersion(supabase, userId)
  const cached = baselineCache.get(userId, version)
  // A cached null is a real answer — "this user has no memory yet" is worth
  // not recomputing — so only undefined counts as a miss.
  if (cached !== undefined) return cached

  const [personalResult, bulkResult, indexResult, lessons] = await Promise.all([
    // A. Personal: everything narrative except raw Perplexity/ChatGPT imports.
    //    [source:claude] rows ARE included — they are Claude Code sessions, and
    //    so are the import-time LLM summaries of bulk sources: the old
    //    `[source:chatgpt]%` predicate did not match `[source:chatgpt:summary]`,
    //    so those landed here, under the 1 500-char cap rather than the 400-char
    //    bulk one. Keeping them here preserves that.
    //
    //    The source list is positive rather than a negation because the CHECK
    //    constraint added with these columns closes the set to exactly four
    //    values, so (claude, other) is the complement of (perplexity, chatgpt).
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .in("kind", ["conversation", "summary"])
      .or("kind.eq.summary,source.in.(claude,other)")
      .order("created_at", { ascending: false })
      .limit(MAX_PERSONAL_ROWS),

    // B. Bulk imports: raw Perplexity + ChatGPT conversations, title-only when
    //    building context. Their LLM summaries are kind "summary" and belong to
    //    query A, which is where the previous predicates put them.
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .eq("kind", "conversation")
      .in("source", ["perplexity", "chatgpt"])
      .order("created_at", { ascending: false })
      .limit(MAX_BULK_ROWS),

    // C. Index rows
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .eq("kind", "index")
      .order("created_at", { ascending: false })
      .limit(MAX_INDEX_ROWS),

    // Lessons (separate from conversation history) — fetched in the same
    // round-trip batch instead of serially after the three queries above.
    getLessons(supabase, userId)
  ])

  const sections = buildSummarySections(
    lessons,
    indexResult.data ?? [],
    personalResult.data ?? [],
    bulkResult.data ?? []
  )

  baselineCache.set(userId, version, sections)

  return sections
}

/** Test seam — lets a suite start from a known-cold cache. */
export function __clearBaselineCache(): void {
  baselineCache.clear()
}

interface SummaryRow {
  content: string | null
}

/**
 * Assemble the injectable memory sections from already-fetched rows.
 *
 * Lessons and conversation history are INDEPENDENT layers: a user with a
 * populated lessons document but no summary rows — or one who cleared their
 * summaries from the memory panel — must still get their lessons. This used to
 * bail out early on `personalData.length === 0 && bulkData.length === 0`,
 * which discarded lessons that had already been fetched successfully, while
 * the instructions block kept telling the model [LESSONS] was the highest
 * quality signal and to read it first.
 *
 * Returning null is decided at the end instead, where it means what it says:
 * nothing at all to inject.
 *
 * Pure + exported so the budgets and the layer independence can be unit-tested
 * without a database.
 */
export function buildSummarySections(
  lessons: string | null,
  indexData: SummaryRow[],
  personalData: SummaryRow[],
  bulkData: SummaryRow[]
): string | null {
  const parts: string[] = []

  // 1. Index rows (tiny, high-value for history questions)
  for (const row of indexData.slice(0, MAX_INDEX_ROWS)) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    parts.push(content)
  }

  // 2. Personal rows — compact summaries, large budget
  let personalChars = 0
  for (const row of personalData) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    const capped = cap(content, PERSONAL_ROW_MAX)
    if (personalChars + capped.length > PERSONAL_BUDGET) break
    parts.push(capped)
    personalChars += capped.length
  }

  // 3. Bulk rows — topic excerpts only
  let bulkChars = 0
  for (const row of bulkData) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    const capped = cap(content, BULK_ROW_MAX)
    if (bulkChars + capped.length > BULK_BUDGET) break
    parts.push(capped)
    bulkChars += capped.length
  }

  const sections: string[] = []

  if (lessons) {
    sections.push(
      `[LESSONS — Accumulated knowledge about you from past sessions]\n${lessons}\n[/LESSONS]`
    )
  }

  if (parts.length > 0) {
    sections.push(
      `[CONVERSATION HISTORY — newest entries first]\n${parts.join("\n\n---\n\n")}\n[/CONVERSATION HISTORY]`
    )
  }

  return sections.length > 0 ? sections.join("\n\n") : null
}
