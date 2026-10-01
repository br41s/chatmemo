// How much memory arrived, month by month, by source.
//
// The timeline lists conversations; this is the shape of the whole history
// at a glance — the months a source was busy, the gaps, the growth — and a
// way to jump the list to a month. Pure so it can be tested without a
// database: the route hands it rows, it hands back months.

import type { MemoryDbSource } from "@/lib/memory-stats"
import { MEMORY_DB_SOURCES } from "@/lib/memory-stats"

export interface ActivityRow {
  /** The row's conversation date, or when it was written. */
  effective_at: string | null
  source: string | null
}

export interface ActivityMonth {
  /** `YYYY-MM`. */
  month: string
  counts: Record<MemoryDbSource, number>
  total: number
}

const emptyCounts = (): Record<MemoryDbSource, number> => ({
  claude: 0,
  claude_code: 0,
  copilot: 0,
  chatgpt: 0,
  perplexity: 0,
  other: 0
})

const isSource = (value: string | null): value is MemoryDbSource =>
  value !== null && (MEMORY_DB_SOURCES as readonly string[]).includes(value)

/** The month after `YYYY-MM`. */
function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, m, 1))
  return date.toISOString().slice(0, 7)
}

/**
 * Rows grouped into consecutive months, oldest first.
 *
 * Every month from the first to the last is present, so a quiet month shows
 * as a gap and not as a missing bar. A row with no source counts under
 * "other", as the empty-state chips do; a row with no date is left out.
 */
export function activityByMonth(rows: ActivityRow[]): ActivityMonth[] {
  const byMonth = new Map<string, Record<MemoryDbSource, number>>()
  for (const row of rows) {
    const month = row.effective_at?.slice(0, 7)
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue
    const counts = byMonth.get(month) ?? emptyCounts()
    counts[isSource(row.source) ? row.source : "other"] += 1
    byMonth.set(month, counts)
  }
  if (byMonth.size === 0) return []

  const months = [...byMonth.keys()].sort()
  const out: ActivityMonth[] = []
  for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth(m)) {
    const counts = byMonth.get(m) ?? emptyCounts()
    out.push({
      month: m,
      counts,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0)
    })
  }
  return out
}

/** `YYYY-MM` as "Sep 2026", in the viewer's language. */
export function monthLabel(month: string, locale?: string): string {
  const [year, m] = month.split("-").map(Number)
  return new Date(year, m - 1, 1).toLocaleDateString(locale, {
    month: "short",
    year: "numeric"
  })
}

/** The first and last day of `YYYY-MM`, for the timeline's date filter. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number)
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`
  }
}
