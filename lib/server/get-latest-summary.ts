import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

// TODO: replace with Tables<"summaries"> once migration is applied and
//       `npm run db-types` has been run.
type SummaryRow = { content: string }

export async function getLatestSummaryForUser(
  userId: string
): Promise<string | null> {
  const supabase = createClient(cookies())

  const { data, error } = await supabase
    .from("summaries")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[getLatestSummaryForUser] Supabase error:", error.message)
    return null
  }

  return (data as SummaryRow | null)?.content ?? null
}
