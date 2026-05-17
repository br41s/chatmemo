import { createClient } from "@/lib/supabase/server"
import { Tables } from "@/supabase/types"
import { cookies } from "next/headers"

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

  return (data as Pick<Tables<"summaries">, "content"> | null)?.content ?? null
}
