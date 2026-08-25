import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Fetch the user's current lessons document.
 * Returns null if none exists yet.
 */
export async function getLessons(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("user_lessons")
    .select("content")
    .eq("user_id", userId)
    .maybeSingle()

  const content = data?.content?.trim()
  return content || null
}

export interface LessonsRecord {
  content: string | null
  /** The version a later write must still find in place to be allowed. */
  updatedAt: string | null
}

/**
 * Fetch the document together with the version stamp needed to write it back
 * safely.
 */
export async function getLessonsRecord(
  supabase: SupabaseClient,
  userId: string
): Promise<LessonsRecord> {
  const { data } = await supabase
    .from("user_lessons")
    .select("content, updated_at")
    .eq("user_id", userId)
    .maybeSingle()

  return {
    content: data?.content?.trim() || null,
    updatedAt: data?.updated_at ?? null
  }
}

/**
 * Replace the lessons document only if it has not changed since it was read.
 *
 * The blind upsert this replaces made concurrent summarise calls a
 * last-write-wins race: two chats finishing together both read the same
 * document, both rewrote it from their own conversation, and whichever landed
 * second silently discarded the other's facts. Conditioning the update on the
 * `updated_at` seen at read time turns that into a detectable miss instead.
 *
 * Returns whether this writer won. A loser should not retry blindly — the
 * winner's document is now the base, and rewriting from a stale one would
 * reintroduce exactly the loss being prevented.
 */
export async function replaceLessons(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  expectedUpdatedAt: string | null
): Promise<boolean> {
  const now = new Date().toISOString()

  // No row seen at read time: insert, and let the unique constraint on
  // user_id decide if another writer got there first.
  if (expectedUpdatedAt === null) {
    const { error } = await supabase
      .from("user_lessons")
      .insert({ user_id: userId, content, updated_at: now })
    return !error
  }

  const { data, error } = await supabase
    .from("user_lessons")
    .update({ content, updated_at: now })
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("user_id")

  return !error && (data?.length ?? 0) > 0
}

/**
 * Upsert the user's lessons document (replaces the current version).
 *
 * Unconditional. Prefer replaceLessons anywhere a concurrent writer is
 * possible; this remains for callers that own the document outright.
 */
export async function upsertLessons(
  supabase: SupabaseClient,
  userId: string,
  content: string
): Promise<void> {
  await supabase
    .from("user_lessons")
    .upsert(
      { user_id: userId, content, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
}
