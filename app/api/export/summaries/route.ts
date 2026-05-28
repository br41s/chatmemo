/**
 * GET /api/export/summaries
 *
 * Returns all summary rows for the authenticated user, grouped by source.
 * Used by the client to download per-source backup JSON files.
 *
 * Response shape:
 * {
 *   version: 1,
 *   exportedAt: string,
 *   sources: {
 *     claude:     { content, created_at }[]
 *     chatgpt:    { content, created_at }[]
 *     perplexity: { content, created_at }[]
 *     other:      { content, created_at }[]
 *   }
 * }
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

type Row = { content: string; created_at: string }

function detectExportSource(
  content: string
): "claude" | "chatgpt" | "perplexity" | "other" {
  if (content.startsWith("[source:claude]")) return "claude"
  if (content.startsWith("[source:chatgpt]")) return "chatgpt"
  if (content.startsWith("[source:perplexity]")) return "perplexity"
  return "other"
}

export async function GET() {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id
    const supabase = createClient(cookies())

    const { data, error } = await supabase
      .from("summaries")
      .select("content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    const grouped: Record<string, Row[]> = {
      claude: [],
      chatgpt: [],
      perplexity: [],
      other: []
    }

    for (const row of data ?? []) {
      const src = detectExportSource(row.content ?? "")
      grouped[src].push({ content: row.content, created_at: row.created_at })
    }

    return NextResponse.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      sources: grouped
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
