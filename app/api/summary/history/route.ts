import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { Database } from "@/supabase/types"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

export type SummaryRow = Database["public"]["Tables"]["summaries"]["Row"]

export async function GET() {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    const supabase = createClient(cookies())

    const { data, error } = await supabase
      .from("summaries")
      .select("id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json({ summaries: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
