import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

/** Max total chars injected into the system prompt as memory context. */
const MAX_MEMORY_CHARS = 48_000

/**
 * How many most-recent rows to pull for the main memory block.
 * With raw ChatGPT rows (~10k chars each) this gives roughly 4-5 rows
 * before hitting MAX_MEMORY_CHARS — which covers the most recent ~25 convs.
 */
const MAX_RECENT_ROWS = 50

/**
 * Additionally fetch the most recent N date-index rows separately so the
 * AI can answer questions like "what was my first conversation?" even when
 * the oldest raw rows are pushed out by the char limit.
 * Index rows are compact (~50 chars per entry) so they don't eat much budget.
 */
const MAX_INDEX_ROWS = 5
const INDEX_MARKER = "Conversation Index"

/**
 * Returns memory content to inject into the system prompt.
 *
 * Strategy:
 *   1. Fetch up to MAX_RECENT_ROWS most-recent summary rows (newest first).
 *   2. Fetch up to MAX_INDEX_ROWS date-index rows (compact conversation lists).
 *   3. De-duplicate, then cap at MAX_MEMORY_CHARS.
 *   Index rows are prepended so the AI sees the full conversation list before
 *   the detailed recent excerpts.
 */
export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  // Fetch recent rows (all types)
  const { data: recentData, error: recentError } = await supabase
    .from("summaries")
    .select("id, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_ROWS)

  if (recentError) {
    console.error(
      "[getLatestSummaryForUser] Supabase error:",
      recentError.message
    )
    return null
  }

  if (!recentData || recentData.length === 0) return null

  // Separate index rows from content rows
  const recentIds = new Set(recentData.map(r => r.id))
  const indexRows: string[] = []
  const contentRows: string[] = []

  for (const row of recentData) {
    const content = row.content?.trim() ?? ""
    if (!content) continue
    if (content.includes(INDEX_MARKER)) {
      indexRows.push(content)
    } else {
      contentRows.push(content)
    }
  }

  // If we don't have enough index rows in the recent batch, fetch more
  if (indexRows.length < MAX_INDEX_ROWS) {
    const { data: idxData } = await supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("content", `%${INDEX_MARKER}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_INDEX_ROWS)

    for (const row of idxData ?? []) {
      if (recentIds.has(row.id)) continue // already included
      const content = row.content?.trim() ?? ""
      if (content) indexRows.push(content)
    }
  }

  // Build final content within char budget
  const parts: string[] = []
  let totalChars = 0

  // Index rows first (compact, high-value for history queries)
  for (const idx of indexRows.slice(0, MAX_INDEX_ROWS)) {
    if (totalChars + idx.length > MAX_MEMORY_CHARS) break
    parts.push(idx)
    totalChars += idx.length
  }

  // Then recent content rows
  for (const content of contentRows) {
    if (totalChars + content.length > MAX_MEMORY_CHARS) break
    parts.push(content)
    totalChars += content.length
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : null
}
