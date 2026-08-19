import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  parsePageParams,
  takePage,
  TIMELINE_PAGE
} from "@/lib/server/pagination"
import { createClient } from "@/lib/supabase/server"
import { parseSummariesToEntries } from "@/lib/timeline-parser"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    const { limit, offset } = parsePageParams(
      request.nextUrl.searchParams,
      TIMELINE_PAGE
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

    return NextResponse.json({
      entries: parseSummariesToEntries(page),
      nextOffset
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
