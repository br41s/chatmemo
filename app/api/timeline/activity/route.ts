import { requireUser } from "@/lib/server/require-user"
import { MEMORY_ORDER_COLUMN } from "@/lib/summary-metadata"
import { activityByMonth, ActivityRow } from "@/lib/timeline-activity"
import { NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

/** The rows that are memory: watermarks and index rows are bookkeeping. */
const MEMORY_KINDS = ["conversation", "summary"]

/** PostgREST's own per-request ceiling. */
const PAGE = 1_000

/**
 * Memory by month and source, for the timeline's activity chart.
 *
 * Two small columns for every memory row, grouped here. Thousands of rows
 * are a few tens of kilobytes; if a history ever reaches the hundreds of
 * thousands this becomes a grouped query instead.
 */
export async function GET() {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response
    const { supabase, userId } = auth

    // PostgREST answers at most 1,000 rows per request, silently. A
    // history of 1,337 rows came back as its oldest 1,000, and the chart
    // showed the busiest month of the year as its quietest. Paged until a
    // page comes back short.
    const rows: ActivityRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("summaries")
        .select(`${MEMORY_ORDER_COLUMN}, source`)
        .eq("user_id", userId)
        .in("kind", MEMORY_KINDS)
        .order(MEMORY_ORDER_COLUMN, { ascending: true })
        .range(from, from + PAGE - 1)

      if (error) {
        return NextResponse.json({ message: error.message }, { status: 500 })
      }
      for (const row of data ?? []) {
        const record = row as Record<string, string | null>
        rows.push({
          effective_at: record[MEMORY_ORDER_COLUMN],
          source: record.source
        })
      }
      if ((data?.length ?? 0) < PAGE) break
    }

    return NextResponse.json({ months: activityByMonth(rows) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}
