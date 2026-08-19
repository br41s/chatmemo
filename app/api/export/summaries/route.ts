/**
 * GET /api/export/summaries?limit=&offset=
 *
 * Returns one page of the user's summary rows, grouped by source. The client
 * follows `nextOffset` until it is null and merges the pages, so a backup is
 * still complete without any single response carrying the whole table.
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
 *   },
 *   nextOffset: number | null
 * }
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { EXPORT_PAGE, parsePageParams, takePage } from "@/lib/server/pagination"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

type Row = { content: string; created_at: string }

// Header pattern: ### [YYYY-MM-DD] anything
const HEADER_RE = /^\s*###\s+\[\d{4}-\d{2}-\d{2}\]/

function detectExportSource(
  content: string
): "claude" | "chatgpt" | "perplexity" | "other" {
  // ── Explicit source tags (new format) ──────────────────────────────────
  // :summary sub-tags must be checked before the plain [source:X] patterns
  if (content.startsWith("[source:perplexity:summary]")) return "perplexity"
  if (content.startsWith("[source:chatgpt:summary]")) return "chatgpt"
  if (content.startsWith("[source:claude]")) return "claude"
  if (content.startsWith("[source:chatgpt]")) return "chatgpt"
  if (content.startsWith("[source:perplexity]")) return "perplexity"

  // ── Watermark rows — route to the matching source ──────────────────────
  const wmMatch = content.match(/^\[chatmemo:watermark:source=(\w+)/)
  if (wmMatch) {
    const s = wmMatch[1]
    if (s === "claude") return "claude"
    if (s === "chatgpt") return "chatgpt"
    if (s === "perplexity") return "perplexity"
  }

  // ── Legacy index rows ──────────────────────────────────────────────────
  if (content.startsWith("[Claude Conversation Index")) return "claude"
  if (content.startsWith("[ChatGPT Conversation Index")) return "chatgpt"
  if (content.startsWith("[Perplexity Conversation Index")) return "perplexity"

  // ── Untagged rows with ### [date] headers ─────────────────────────────
  // Created by import-claude-sessions.mjs (bulk import) or the bookmarklet.
  // Both are Claude-origin entries stored before source tagging was added.
  if (HEADER_RE.test(content)) return "claude"

  // ── Everything else (sync-hook bullets, in-app summaries) ─────────────
  return "other"
}

export async function GET(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id
    const supabase = createClient(cookies())

    const { limit, offset } = parsePageParams(
      request.nextUrl.searchParams,
      EXPORT_PAGE
    )

    // Oldest first, so rows written while an export is running are only ever
    // appended past the last page — offset paging cannot skip earlier rows.
    // One row past the page, so hasMore needs no second query.
    const { data, error } = await supabase
      .from("summaries")
      .select("content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit)

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    const { page, nextOffset } = takePage(data ?? [], limit, offset)

    const grouped: Record<string, Row[]> = {
      claude: [],
      chatgpt: [],
      perplexity: [],
      other: []
    }

    for (const row of page) {
      const src = detectExportSource(row.content ?? "")
      grouped[src].push({ content: row.content, created_at: row.created_at })
    }

    return NextResponse.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      sources: grouped,
      nextOffset
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
