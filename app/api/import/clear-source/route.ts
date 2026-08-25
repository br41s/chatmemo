import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

// Old date-index first-line patterns (for rows imported before source tagging)
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

    // One predicate replaces the four content patterns this used to sweep for.
    // The typed source column already covers the tagged rows, their `:summary`
    // variants, the watermark and the legacy date-index rows, because all four
    // classify to the same source.
    const deleteOps = [
      supabase
        .from("summaries")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .eq("source", source)
        .then(({ count, error }) => ({ count, error }))
    ]

    // Untagged raw Perplexity rows carry no source marker of any kind, so they
    // classify as "other" and need their own pattern.
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
