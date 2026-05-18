import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function DELETE(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const { id } = await request.json()

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { success: false, reason: "Missing id" },
        { status: 400 }
      )
    }

    const supabase = createClient(cookies())
    const { error } = await supabase
      .from("summaries")
      .delete()
      .eq("id", id)
      .eq("user_id", profile.user_id)

    if (error) {
      return NextResponse.json(
        { success: false, reason: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
