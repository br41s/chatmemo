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

    // Run all delete operations in parallel — they target non-overlapping content patterns.
    const deleteOps: Promise<{ count: number | null; error: unknown }>[] = [
      // 1. New format: "[source:X]\n..."
      supabase
        .from("summaries")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .like("content", `[source:${source}]%`)
        .then(({ count, error }) => ({ count, error })),

      // 2. LLM summary rows: "[source:X:summary]\n..."
      supabase
        .from("summaries")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .like("content", `[source:${source}:summary]%`)
        .then(({ count, error }) => ({ count, error })),

      // 3. Watermark so next import starts fresh
      supabase
        .from("summaries")
        .delete()
        .eq("user_id", userId)
        .like("content", `[chatmemo:watermark:source=${source} ts=%`)
        .then(() => ({ count: 0, error: null }))
    ]

    // 4. Legacy date-index rows (old format, no source tag)
    const legacyPrefix = LEGACY_DATE_INDEX[source]
    if (legacyPrefix) {
      deleteOps.push(
        supabase
          .from("summaries")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .like("content", `${legacyPrefix}%`)
          .then(({ count, error }) => ({ count, error }))
      )
    }

    // 5. Perplexity-specific: catch old raw rows without a [source:] tag
    if (source === "perplexity") {
      deleteOps.push(
        supabase
          .from("summaries")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .ilike("content", "%Source: Perplexity /%")
          .then(({ count, error }) => ({ count, error }))
      )
    }

    const results = await Promise.all(deleteOps)
    let deleted = 0
    for (const { count, error } of results) {
      if (!error) deleted += count ?? 0
    }

    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
