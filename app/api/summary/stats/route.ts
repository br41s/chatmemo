import { MEMORY_DB_SOURCES, MemoryStats } from "@/lib/memory-stats"
import { requireUser } from "@/lib/server/require-user"
import { MEMORY_ORDER_COLUMN } from "@/lib/summary-metadata"
import { NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

/** The rows that can reach a conversation: watermarks are bookkeeping and
 *  index rows are lists of other rows, so neither is memory in the sense the
 *  screen is claiming. */
const MEMORY_KINDS = ["conversation", "summary"]

/**
 * How much memory this user actually has, and where it came from.
 *
 * Head-only exact counts — one overall, one per source — plus the newest
 * conversation date, all in parallel. Six cheap queries rather than one
 * scan: the empty chat screen renders on every new chat, and it must stay
 * cheap no matter how many rows there are.
 */
export async function GET() {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response
    const { supabase, userId } = auth

    const countRows = () =>
      supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("kind", MEMORY_KINDS)

    const [total, newest, ...perSource] = await Promise.all([
      countRows(),
      supabase
        .from("summaries")
        .select(MEMORY_ORDER_COLUMN)
        .eq("user_id", userId)
        .in("kind", MEMORY_KINDS)
        .order(MEMORY_ORDER_COLUMN, { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      ...MEMORY_DB_SOURCES.map(source => countRows().eq("source", source))
    ])

    const failed = [total, newest, ...perSource].find(result => result.error)
    if (failed?.error) {
      return NextResponse.json(
        { message: failed.error.message },
        { status: 500 }
      )
    }

    const stats: MemoryStats = {
      total: total.count ?? 0,
      bySource: Object.fromEntries(
        MEMORY_DB_SOURCES.map((source, index) => [
          source,
          perSource[index].count ?? 0
        ])
      ),
      newest: newestDate(newest.data)
    }

    return NextResponse.json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ message }, { status: 500 })
  }
}

/** The calendar date of the newest row, or null when there is none. */
function newestDate(row: Record<string, unknown> | null): string | null {
  const value = row?.[MEMORY_ORDER_COLUMN]
  return typeof value === "string" && value.length >= 10
    ? value.slice(0, 10)
    : null
}
