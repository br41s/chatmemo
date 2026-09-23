import { requireUser } from "@/lib/server/require-user"
import { NextRequest, NextResponse } from "next/server"

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response
    const { supabase, userId } = auth
    const { id } = await request.json()

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { success: false, reason: "Missing id" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("summaries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)

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
