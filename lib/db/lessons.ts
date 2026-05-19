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

/**
 * Upsert the user's lessons document (replaces the current version).
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
