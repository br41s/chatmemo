import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  HISTORY_PAGE,
  parsePageParams,
  takePage
} from "@/lib/server/pagination"
import { createClient } from "@/lib/supabase/server"
import { Database } from "@/supabase/types"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

export type SummaryRow = Database["public"]["Tables"]["summaries"]["Row"]

export async function GET(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    const { limit, offset } = parsePageParams(
      request.nextUrl.searchParams,
      HISTORY_PAGE
    )

    const supabase = createClient(cookies())

    // One row past the page, so hasMore needs no second query.
    const { data, error } = await supabase
      .from("summaries")
      .select("id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit)

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    const { page, nextOffset } = takePage(data ?? [], limit, offset)

    return NextResponse.json({ summaries: page, nextOffset })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
