import { SupabaseClient } from "@supabase/supabase-js"
import { Database, TablesInsert } from "@/supabase/types"
import { summaryMetadataColumns } from "@/lib/summary-metadata"

/**
 * A write rejected because the database does not have a column the code is
 * sending.
 *
 * PostgREST reports this two ways depending on where it is caught: `PGRST204`
 * from its own schema cache, or Postgres's `42703` (undefined_column) when the
 * statement reaches the server. Both mean the same thing, and both are
 * recoverable — unlike a constraint violation or an RLS refusal, which must
 * keep failing.
 */
function isUnknownColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204" || error.code === "42703") return true
  // Older PostgREST builds report it as a schema-cache miss with no usable
  // code, so the message is the only signal left.
  return /column .* does not exist|could not find the .* column/i.test(
    error.message ?? ""
  )
}

/** Columns the `summaries` table has had since it was created. */
const REQUIRED_COLUMNS = ["user_id", "content"] as const

/**
 * Insert a summary row, deriving its typed metadata from the content.
 *
 * The prefixes stay in `content` — the injected memory block quotes them and
 * the backup format depends on them — but source, kind, title and the
 * conversation's own date are also written to columns, so readers filter on
 * indexed values instead of each re-deriving them from the text.
 *
 * Every column beyond `user_id` and `content` arrived in a later migration,
 * and this is what happens when the code ships ahead of one: the insert is
 * rejected for a column the database has never heard of, and the memory that
 * turn produced is gone. Not degraded — gone, with the chat still working and
 * nothing on screen to say otherwise. It is how three weeks of in-app
 * conversations went unrecorded: `chat_id` shipped, its migration did not, and
 * every summarise call since had failed silently.
 *
 * So a rejection for an unknown column is not fatal here. The row is written
 * again with only the columns the table is guaranteed to have, and the memory
 * survives. The `summaries_derive_metadata` trigger fills the dropped columns
 * back in from `content`, which is where all of it came from in the first
 * place — without them the memory reads, which filter on `kind`, never see it.
 *
 * Anything else — a constraint violation, an RLS refusal, a dead connection —
 * still throws. Those are not schema lag and must not be papered over.
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

  if (!error) return data.id

  if (!isUnknownColumn(error)) {
    throw new Error(`[insertSummary] ${error.message}`)
  }

  const dropped = Object.keys(row).filter(
    column =>
      !REQUIRED_COLUMNS.includes(column as (typeof REQUIRED_COLUMNS)[number])
  )

  // Loud on purpose. The point of the fallback is that memory is not lost; the
  // point of the warning is that nobody discovers the missing migration weeks
  // later by asking the assistant what happened yesterday.
  console.warn(
    `[insertSummary] schema is behind the code — the database rejected ` +
      `${dropped.join(", ")}. Writing the row without them; apply the pending ` +
      `migration (npm run db-push). Original error: ${error.message}`
  )

  const fallback = await supabase
    .from("summaries")
    .insert({ user_id: userId, content })
    .select("id")
    .single()

  if (fallback.error) {
    throw new Error(`[insertSummary] ${fallback.error.message}`)
  }

  return fallback.data.id
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
