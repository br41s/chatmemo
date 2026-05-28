import { createClient } from "@/lib/supabase/server"
import { getLessons } from "@/lib/db/lessons"
import { cookies } from "next/headers"

// ---------------------------------------------------------------------------
// Memory budget
//
// Personal rows (Claude Code sessions, sync hook, bookmarklet) are compact
// LLM summaries (~1 500 chars each). We give them a large budget so ALL of
// them fit regardless of when they were imported — FinView from January is
// just as accessible as a session from yesterday.
//
// Bulk import rows (Perplexity, ChatGPT) store the full raw conversation
// (~10 k chars each). We include only the opening 400 chars — enough to give
// the AI topic awareness — so they can't crowd out personal sessions.
//
// Total injected: up to ~95 k tokens. Fits comfortably inside the 131 k
// context window of Llama 3.3 70B (current default free model).
// ---------------------------------------------------------------------------

const PERSONAL_BUDGET = 320_000 // chars — covers ~200 sessions at 1 600 avg
const BULK_BUDGET = 40_000 // chars — covers ~100 Perplexity/ChatGPT titles

const PERSONAL_ROW_MAX = 2_000 // cap per personal row (already compact)
const BULK_ROW_MAX = 400 // title + opening line only for bulk rows

const MAX_PERSONAL_ROWS = 500 // fetch all personal sessions, no date cutoff
const MAX_BULK_ROWS = 50 // only recent bulk rows are useful
const MAX_INDEX_ROWS = 5

const INDEX_MARKER = "Conversation Index"

function isBulkRow(content: string): boolean {
  return (
    content.startsWith("[source:perplexity]") ||
    content.startsWith("[source:chatgpt]")
  )
}

function isIndexRow(content: string): boolean {
  return content.includes(INDEX_MARKER)
}

function cap(content: string, max: number): string {
  return content.length > max ? content.slice(0, max) + "…" : content
}

/**
 * Returns memory content to inject into the system prompt.
 *
 * Three parallel queries:
 *   A. Personal rows — no [source:X] tag: Claude Code sessions, VS Code
 *      sync hook, bookmarklet entries. Fetched with a high limit (500) so
 *      every project the user has ever worked on is always in context.
 *   B. Recent bulk rows — Perplexity + ChatGPT. Title-only (400 chars) so
 *      they don't dominate the budget.
 *   C. Index rows — compact conversation lists.
 */
export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  const [personalResult, bulkResult, indexResult] = await Promise.all([
    // A. Personal: no source tag, no watermarks, no index rows
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .not("content", "like", "[source:%]%")
      .not("content", "like", "[chatmemo:%]%")
      .not("content", "ilike", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_PERSONAL_ROWS),

    // B. Bulk imports: only recent, title-only when building context
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
      .limit(MAX_INDEX_ROWS)
  ])

  const personalData = personalResult.data ?? []
  const bulkData = bulkResult.data ?? []
  const indexData = indexResult.data ?? []

  if (personalData.length === 0 && bulkData.length === 0) return null

  const parts: string[] = []
  let totalChars = 0

  // 1. Index rows (tiny, high-value for history questions)
  for (const row of indexData.slice(0, MAX_INDEX_ROWS)) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    parts.push(content)
    totalChars += content.length
  }

  // 2. Personal rows — full summaries, large budget
  let personalChars = 0
  for (const row of personalData) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    const capped = cap(content, PERSONAL_ROW_MAX)
    if (personalChars + capped.length > PERSONAL_BUDGET) break
    parts.push(capped)
    personalChars += capped.length
    totalChars += capped.length
  }

  // 3. Bulk rows — titles only
  let bulkChars = 0
  for (const row of bulkData) {
    const content = (row.content ?? "").trim()
    if (!content) continue
    const capped = cap(content, BULK_ROW_MAX)
    if (bulkChars + capped.length > BULK_BUDGET) break
    parts.push(capped)
    bulkChars += capped.length
    totalChars += capped.length
  }

  // Lessons (separate from conversation history)
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
