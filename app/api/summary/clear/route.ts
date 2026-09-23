import { requireUser } from "@/lib/server/require-user"
import { NextResponse } from "next/server"

export async function DELETE() {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response
    const { supabase, userId } = auth

    const { error, count } = await supabase
      .from("summaries")
      .delete({ count: "exact" })
      .eq("user_id", userId)

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
