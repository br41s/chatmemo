import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function DELETE() {
  try {
    const profile = await getServerProfile()
    const supabase = createClient(cookies())

    const { error, count } = await supabase
      .from("summaries")
      .delete({ count: "exact" })
      .eq("user_id", profile.user_id)

    if (error) {
      return NextResponse.json(
        { success: false, reason: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, deleted: count ?? 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
