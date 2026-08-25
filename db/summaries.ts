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
  content: string,
  chatId?: string | null
): Promise<string> {
  const row: TablesInsert<"summaries"> = {
    user_id: userId,
    content,
    ...summaryMetadataColumns(content),
    ...(chatId ? { chat_id: chatId } : {})
  }

  const { data, error } = await supabase
    .from("summaries")
    .insert(row)
    .select("id")
    .single()

  if (error) {
    throw new Error(`[insertSummary] ${error.message}`)
  }

  return data.id
}

/**
 * Replace a chat's stored summary with a fresh one.
 *
 * The summarise route fires after every turn, so appending produced roughly
 * nine near-identical rows for a twenty-message conversation — bloating both
 * the table and the injected memory block with the same facts restated.
 *
 * Insert first, then remove the older rows for that chat. The other order
 * would leave the conversation with no memory at all if the insert failed;
 * this way the worst case is a brief duplicate that the next turn clears.
 *
 * Rows written before chat_id existed have no chat and are left alone — they
 * are real history, just no longer replaceable.
 */
export async function replaceChatSummary(
  supabase: SupabaseClient<Database>,
  userId: string,
  chatId: string,
  content: string
): Promise<void> {
  const insertedId = await insertSummary(supabase, userId, content, chatId)

  const { error } = await supabase
    .from("summaries")
    .delete()
    .eq("user_id", userId)
    .eq("chat_id", chatId)
    .neq("id", insertedId)

  // Non-fatal: the new summary is already stored, and a stale sibling costs
  // budget rather than correctness.
  if (error) {
    console.warn(`[replaceChatSummary] could not prune: ${error.message}`)
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
