import { SupabaseClient } from "@supabase/supabase-js"
import { Database, TablesInsert } from "@/supabase/types"
import { summaryMetadataColumns } from "@/lib/summary-metadata"

/**
 * Insert a summary row, deriving its typed metadata from the content.
 *
 * The prefixes stay in `content` — the injected memory block quotes them and
 * the backup format depends on them — but source, kind, title and the
 * conversation's own date are also written to columns, so readers filter on
 * indexed values instead of each re-deriving them from the text.
 */
export async function insertSummary(
  supabase: SupabaseClient<Database>,
  userId: string,
  content: string
): Promise<void> {
  const row: TablesInsert<"summaries"> = {
    user_id: userId,
    content,
    ...summaryMetadataColumns(content)
  }

  const { error } = await supabase.from("summaries").insert(row)

  if (error) {
    throw new Error(`[insertSummary] ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Import watermarks — track the newest timestamp seen per source so
// subsequent imports can skip already-imported conversations.
// Stored as a special summary row: [chatmemo:watermark:source=X ts=N]
// ---------------------------------------------------------------------------

const WATERMARK_RE = /^\[chatmemo:watermark:source=(\S+) ts=(\d+)\]$/

/**
 * Returns the last-imported unix-ms timestamp for a given source, or 0 if
 * no watermark exists.
 */
export async function getWatermark(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: string
): Promise<number> {
  const { data } = await supabase
    .from("summaries")
    .select("content")
    .eq("user_id", userId)
    .eq("kind", "watermark")
    .eq("source", source)
    .maybeSingle()

  if (!data?.content) return 0
  const match = data.content.match(WATERMARK_RE)
  return match ? parseInt(match[2], 10) : 0
}

/**
 * Upserts the watermark for a source: deletes the old row (if any) and
 * inserts a fresh one with the new timestamp.
 */
export async function setWatermark(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: string,
  ts: number
): Promise<void> {
  await supabase
    .from("summaries")
    .delete()
    .eq("user_id", userId)
    .eq("kind", "watermark")
    .eq("source", source)

  await insertSummary(
    supabase,
    userId,
    `[chatmemo:watermark:source=${source} ts=${ts}]`
  )
}
