// What the empty chat screen says about the memory behind it.
//
// The number alone ("1,280 memory entries") was honest but flat. Where the
// entries came from, and how recent the newest is, are the two facts that
// make the pile feel like a memory rather than a count — and both are cheap
// to answer from the typed columns the trigger fills.

import type { MemorySourceKey } from "@/lib/memory-report"

/** The `source` column's vocabulary (see summary-metadata.ts). */
export type MemoryDbSource = "claude" | "chatgpt" | "perplexity" | "other"

export const MEMORY_DB_SOURCES: readonly MemoryDbSource[] = [
  "claude",
  "chatgpt",
  "perplexity",
  "other"
]

/** What `/api/summary/stats` answers. */
export interface MemoryStats {
  total: number
  bySource: Partial<Record<MemoryDbSource, number>>
  /** Newest conversation date on record as `YYYY-MM-DD`, or null when empty. */
  newest: string | null
}

export interface MemoryConstellationChip {
  key: MemorySourceKey
  label: string
  count: number
  /** This source's share of the total, 0–1, for sizing. */
  share: number
}

const CHIP_FOR: Record<
  MemoryDbSource,
  { key: MemorySourceKey; label: string }
> = {
  claude: { key: "claude-ai", label: "Claude" },
  chatgpt: { key: "chatgpt", label: "ChatGPT" },
  perplexity: { key: "perplexity", label: "Perplexity" },
  // Untagged rows are the in-app summariser's, so "Chat" is the honest label.
  other: { key: "chat", label: "Chat" }
}

/**
 * The per-source chips, largest first, without the empty ones.
 *
 * Shares are against the reported total rather than the sum of the chips, so
 * a row the source query missed shrinks the chips instead of inflating one.
 */
export function memoryConstellation(
  stats: MemoryStats
): MemoryConstellationChip[] {
  const total = Math.max(stats.total, 0)
  return MEMORY_DB_SOURCES.map(source => ({
    ...CHIP_FOR[source],
    count: Math.max(stats.bySource[source] ?? 0, 0)
  }))
    .filter(chip => chip.count > 0)
    .map(chip => ({
      ...chip,
      share: total > 0 ? Math.min(chip.count / total, 1) : 0
    }))
    .sort((a, b) => b.count - a.count)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "today", "yesterday", "5 days ago", or a short date once it is older than
 * a month. Dates are compared as calendar days in the viewer's timezone, so
 * a memory from late last night is "yesterday" and not "0 days ago".
 */
export function describeNewest(
  newest: string | null,
  now: Date = new Date()
): string | null {
  if (!newest) return null
  const match = newest.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const then = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - then.getTime()) / DAY_MS)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 31) return `${days} days ago`
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: then.getFullYear() === today.getFullYear() ? undefined : "numeric"
  })
}
