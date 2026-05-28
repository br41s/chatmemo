import { createClient } from "@/lib/supabase/server"
import { getLessons } from "@/lib/db/lessons"
import { cookies } from "next/headers"

/** Max total chars injected into the system prompt as memory context. */
const MAX_MEMORY_CHARS = 48_000

/**
 * Per-row char cap: prevents a single large Perplexity/ChatGPT row from
 * consuming the entire budget, leaving room for other entries.
 */
const MAX_ROW_CHARS = 3_000

/**
 * How many "personal" rows to fetch in the dedicated personal query.
 * Personal rows = no [source:X] tag: Claude Code sessions, sync hook,
 * bookmarklet entries. They are often buried by bulk imports in recency order,
 * so we guarantee their presence by fetching them in a separate query.
 */
const MAX_PERSONAL_ROWS = 60

/**
 * How many recent rows of any type to fetch.
 * Captures the most recent bulk import activity (Perplexity, ChatGPT)
 * and any recent personal entries that happen to be new.
 */
const MAX_RECENT_ROWS = 30

/**
 * Budget split: personal rows get the larger half of the memory budget so
 * that Claude Code sessions and bookmarklet entries are always represented,
 * even when recent bulk imports dominate the recency order.
 */
const PERSONAL_BUDGET = Math.floor(MAX_MEMORY_CHARS * 0.55) // ~26 k
const RECENT_BUDGET = MAX_MEMORY_CHARS - PERSONAL_BUDGET // ~22 k

/**
 * Additionally fetch the most recent N date-index rows separately so the
 * AI can answer questions like "what was my first conversation?" even when
 * the oldest raw rows are pushed out by the char limit.
 * Index rows are compact (~50 chars per entry) so they don't eat much budget.
 */
const MAX_INDEX_ROWS = 5
const INDEX_MARKER = "Conversation Index"

function cappedContent(content: string): string {
  return content.length > MAX_ROW_CHARS
    ? content.slice(0, MAX_ROW_CHARS) + "\n… [truncated]"
    : content
}

function isIndexRow(content: string): boolean {
  return content.includes(INDEX_MARKER)
}

function isPersonalRow(content: string): boolean {
  // Personal = no explicit source tag, not a watermark, not an index row
  return (
    !content.startsWith("[source:") &&
    !content.startsWith("[chatmemo:") &&
    !isIndexRow(content)
  )
}

/**
 * Returns memory content to inject into the system prompt.
 *
 * Strategy (two parallel queries):
 *   A. Personal rows (no [source:X] tag — Claude Code sessions, sync hook,
 *      bookmarklet). Fetched separately so bulk imports can't push them out.
 *   B. Recent rows (any source, newest-first). Covers current Perplexity /
 *      ChatGPT activity and any newly-synced personal entries.
 *   C. Index rows (compact conversation lists, fetched in parallel).
 *
 *   Budget: personal rows get ~55% of MAX_MEMORY_CHARS, recent rows ~45%.
 *   Index rows are prepended and come out of the shared budget.
 */
export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  // ── Parallel fetch: personal rows + recent rows + index rows ──────────
  const [personalResult, recentResult, indexResult] = await Promise.all([
    // A. Personal rows: no source tag → Claude Code sessions, sync, bookmarklet
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .not("content", "like", "[source:%]%")
      .not("content", "like", "[chatmemo:%]%")
      .not("content", "ilike", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_PERSONAL_ROWS),

    // B. Recent rows: any source, newest first (captures bulk import activity)
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .not("content", "ilike", `%${INDEX_MARKER}%`)
      .not("content", "like", "[chatmemo:%]%")
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_ROWS),

    // C. Index rows: compact lists of all past conversations
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("content", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_INDEX_ROWS)
  ])

  if (personalResult.error) {
    console.error(
      "[getLatestSummaryForUser] personal query error:",
      personalResult.error.message
    )
  }
  if (recentResult.error) {
    console.error(
      "[getLatestSummaryForUser] recent query error:",
      recentResult.error.message
    )
  }

  const personalData = personalResult.data ?? []
  const recentData = recentResult.data ?? []
  const indexData = indexResult.data ?? []

  if (personalData.length === 0 && recentData.length === 0) return null

  // ── Build context ──────────────────────────────────────────────────────
  const parts: string[] = []
  let totalChars = 0

  // 1. Index rows first (tiny, high-value for history questions)
  for (const row of indexData.slice(0, MAX_INDEX_ROWS)) {
    const content = row.content?.trim() ?? ""
    if (!content) continue
    if (totalChars + content.length > MAX_MEMORY_CHARS) break
    parts.push(content)
    totalChars += content.length
  }

  // 2. Personal rows — dedicated budget so they always appear
  const personalIds = new Set<string>()
  let personalChars = 0

  for (const row of personalData) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    const capped = cappedContent(content)
    if (personalChars + capped.length > PERSONAL_BUDGET) break
    parts.push(capped)
    personalIds.add(row.id)
    personalChars += capped.length
    totalChars += capped.length
  }

  // 3. Recent rows — remaining budget, skip rows already added above
  let recentChars = 0

  for (const row of recentData) {
    if (personalIds.has(row.id)) continue // dedup
    const content = (row.content ?? "").trim()
    if (!content || isIndexRow(content)) continue
    const capped = cappedContent(content)
    if (recentChars + capped.length > RECENT_BUDGET) break
    if (totalChars + capped.length > MAX_MEMORY_CHARS) break
    parts.push(capped)
    recentChars += capped.length
    totalChars += capped.length
  }

  // ── Lessons ────────────────────────────────────────────────────────────
  const lessons = await getLessons(supabase, userId)

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
