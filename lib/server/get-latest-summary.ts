import { createClient } from "@/lib/supabase/server"
import { getLessons } from "@/lib/db/lessons"
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

const INDEX_MARKER = "Conversation Index"

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
export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  const [personalResult, bulkResult, indexResult, lessons] = await Promise.all([
    // A. Personal: exclude Perplexity, ChatGPT, watermarks, and index rows.
    //    [source:claude] rows ARE included — they are Claude Code sessions.
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .not("content", "like", "[source:perplexity]%")
      .not("content", "like", "[source:chatgpt]%")
      .not("content", "like", "[chatmemo:%]%")
      .not("content", "ilike", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_PERSONAL_ROWS),

    // B. Bulk imports: Perplexity + ChatGPT, title-only when building context
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .or("content.like.[source:perplexity]%,content.like.[source:chatgpt]%")
      .order("created_at", { ascending: false })
      .limit(MAX_BULK_ROWS),

    // C. Index rows
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("content", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_INDEX_ROWS),

    // Lessons (separate from conversation history) — fetched in the same
    // round-trip batch instead of serially after the three queries above.
    getLessons(supabase, userId)
  ])

  return buildSummarySections(
    lessons,
    indexResult.data ?? [],
    personalResult.data ?? [],
    bulkResult.data ?? []
  )
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
