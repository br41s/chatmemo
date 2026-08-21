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
import { classifySummaryContent } from "@/lib/summary-metadata"
import { EXPORT_PAGE, parsePageParams, takePage } from "@/lib/server/pagination"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

type Row = { content: string; created_at: string }

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
      .select("content, created_at, source")
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
      // The stored column is the same classification detectExportSource used to
      // re-derive per row; fall back to deriving it for any row written before
      // the typed-metadata migration backfilled them.
      const src = row.source ?? classifySummaryContent(row.content ?? "").source
      const bucket = grouped[src] ?? grouped.other
      bucket.push({ content: row.content, created_at: row.created_at })
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
