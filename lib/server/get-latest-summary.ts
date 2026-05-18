import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

/** Max total chars injected into the system prompt as memory context. */
const MAX_MEMORY_CHARS = 24_000

/** How many most-recent summaries to fetch and concatenate. */
const MAX_SUMMARIES = 25

/**
 * Returns the concatenation of the user's most recent memory summaries,
 * newest first, capped at MAX_MEMORY_CHARS. Returns null if none exist.
 */
export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  const { data, error } = await supabase
    .from("summaries")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_SUMMARIES)

  if (error) {
    console.error("[getLatestSummaryForUser] Supabase error:", error.message)
    return null
  }

  if (!data || data.length === 0) return null

  const parts: string[] = []
  let totalChars = 0

  for (const row of data) {
    const content = row.content?.trim() ?? ""
    if (!content) continue
    if (totalChars + content.length > MAX_MEMORY_CHARS) break
    parts.push(content)
    totalChars += content.length
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : null
}
