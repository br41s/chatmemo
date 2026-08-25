import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

/**
 * How much memory this user actually has.
 *
 * Head-only with an exact count, so it stays a single cheap query no matter how
 * many rows there are — the empty chat screen renders on every new chat, and it
 * only needs the number.
 *
 * Counts the rows that can reach a conversation: watermarks are bookkeeping and
 * index rows are lists of other rows, so neither is memory in the sense the
 * screen is claiming.
 */
export async function GET() {
  try {
    const profile = await getServerProfile()
    const supabase = createClient(cookies())

    const { count, error } = await supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.user_id)
      .in("kind", ["conversation", "summary"])

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json({ total: count ?? 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
