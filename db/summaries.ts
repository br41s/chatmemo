import { SupabaseClient } from "@supabase/supabase-js"
import { Database, TablesInsert } from "@/supabase/types"

export async function insertSummary(
  supabase: SupabaseClient<Database>,
  userId: string,
  content: string
): Promise<void> {
  const row: TablesInsert<"summaries"> = { user_id: userId, content }

  const { error } = await supabase.from("summaries").insert(row)

  if (error) {
    throw new Error(`[insertSummary] ${error.message}`)
  }
}
