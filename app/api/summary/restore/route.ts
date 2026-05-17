import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    const body = await request.json()
    const id = body?.id

    if (typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, reason: "id is required" },
        { status: 400 }
      )
    }

    const supabase = createClient(cookies())

    // Fetch the target row and verify ownership in a single query
    const { data: row, error: fetchError } = await supabase
      .from("summaries")
      .select("id, content, user_id")
      .eq("id", id)
      .eq("user_id", userId) // ownership check — never trust the client
      .maybeSingle()

    if (fetchError) {
      return NextResponse.json({ message: fetchError.message }, { status: 500 })
    }

    if (!row) {
      // Row not found OR doesn't belong to this user — same 404 to avoid enumeration
      return NextResponse.json(
        { success: false, reason: "summary not found" },
        { status: 404 }
      )
    }

    // Re-insert as a new row (original row stays immutable)
    await insertSummary(supabase, userId, row.content)

    return NextResponse.json({ success: true, restored_from: id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
