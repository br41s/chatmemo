import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MIN_CONTENT_WORDS = 3
const MAX_CONTENT_LENGTH = 10_000

export async function POST(request: NextRequest) {
  try {
    // Auth — throws if session is missing or invalid
    const profile = await getServerProfile()
    const userId = profile.user_id

    const body = await request.json()
    const rawContent = body?.content

    if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, reason: "content is required" },
        { status: 400 }
      )
    }

    const content = rawContent.trim()

    if (content.split(/\s+/).length < MIN_CONTENT_WORDS) {
      return NextResponse.json(
        {
          success: true,
          inserted: false,
          reason: "content too short to be useful"
        },
        { status: 200 }
      )
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { success: false, reason: "content exceeds maximum length" },
        { status: 400 }
      )
    }

    const supabase = createClient(cookies())

    await insertSummary(supabase, userId, content)

    return NextResponse.json({ success: true, inserted: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
