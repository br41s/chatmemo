import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

// Old date-index first-line patterns (for rows imported before source tagging)
const LEGACY_DATE_INDEX: Record<string, string> = {
  chatgpt: "[ChatGPT Conversation Index",
  claude: "[Claude Conversation Index",
  perplexity: "[Perplexity Conversation Index"
}

const VALID_SOURCES = ["chatgpt", "claude", "perplexity"] as const
type Source = (typeof VALID_SOURCES)[number]

export async function DELETE(request: NextRequest) {
  try {
    const { source } = (await request.json()) as { source?: string }

    if (!source || !VALID_SOURCES.includes(source as Source)) {
      return NextResponse.json(
        {
          success: false,
          reason: `Invalid source. Must be one of: ${VALID_SOURCES.join(", ")}`
        },
        { status: 400 }
      )
    }

    const profile = await getServerProfile()
    const userId = profile.user_id
    const supabase = createClient(cookies())

    let deleted = 0

    // 1. Delete source-tagged rows (new format: "[source:X]\n...")
    const { count: taggedCount, error: err1 } = await supabase
      .from("summaries")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .like("content", `[source:${source}]%`)

    if (!err1) deleted += taggedCount ?? 0

    // 2. Delete legacy date-index rows (old format, no source tag)
    const legacyPrefix = LEGACY_DATE_INDEX[source]
    if (legacyPrefix) {
      const { count: legacyCount, error: err2 } = await supabase
        .from("summaries")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .like("content", `${legacyPrefix}%`)

      if (!err2) deleted += legacyCount ?? 0
    }

    // 3. Perplexity-specific: also catch old raw rows that contain
    //    "Source: Perplexity /" (written by formatConversationFull).
    //    These were stored without a [source:] tag in the initial import.
    if (source === "perplexity") {
      const { count: oldCount, error: err3 } = await supabase
        .from("summaries")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .ilike("content", "%Source: Perplexity /%")

      if (!err3) deleted += oldCount ?? 0
    }

    // 4. Delete watermark so next import starts fresh
    await supabase
      .from("summaries")
      .delete()
      .eq("user_id", userId)
      .like("content", `[chatmemo:watermark:source=${source} ts=%`)

    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
