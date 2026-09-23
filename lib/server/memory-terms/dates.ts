// Dates mentioned in a request to recover a conversation.
//
// "the conversation from January", "yesterday's chat", "2025-03-14" — each
// narrows the search enough to matter, and each needs its own reading.

export interface DateRange {
  from: Date
  to: Date
}

export const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/** Extract an explicit ISO date (YYYY-MM-DD) if present — used to match the
 *  `### [YYYY-MM-DD]` header embedded in imported summary rows. */
export function extractIsoDate(message: string): string | null {
  const m = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Calendar ranges are UTC: stored timestamps are UTC, and the answer must not
// depend on the server's timezone (Vercel runs in UTC, a laptop may not).
function monthRange(year: number, month: number): DateRange {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59))
  }
}

export function extractDateRange(message: string): DateRange | null {
  const lower = message.toLowerCase()
  const now = new Date()

  // "January 2025" or "2025 January"
  for (const [name, num] of Object.entries(MONTHS)) {
    const re = new RegExp(`(?:${name}\\s+(20\\d{2})|(20\\d{2})\\s+${name})`)
    const m = lower.match(re)
    if (m) {
      return monthRange(parseInt(m[1] ?? m[2]), num)
    }
  }

  // Month name only → most recent occurrence of that month
  for (const [name, num] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      const year = now.getUTCFullYear()
      const range = monthRange(year, num)
      return range.from > now ? monthRange(year - 1, num) : range
    }
  }

  // Bare year "2025"
  const yearM = lower.match(/\b(202\d)\b/)
  if (yearM) {
    const year = parseInt(yearM[1])
    return {
      from: new Date(Date.UTC(year, 0, 1)),
      to: new Date(Date.UTC(year, 11, 31, 23, 59, 59))
    }
  }

  // Relative
  if (lower.includes("yesterday") || lower.includes("ayer")) {
    const from = new Date(now)
    from.setUTCDate(from.getUTCDate() - 1)
    from.setUTCHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setUTCHours(23, 59, 59, 999)
    return { from, to }
  }
  if (lower.includes("last week") || lower.includes("semana pasada")) {
    const from = new Date(now)
    from.setUTCDate(from.getUTCDate() - 7)
    return { from, to: now }
  }
  if (lower.includes("last month") || lower.includes("mes pasado")) {
    const from = new Date(now)
    from.setUTCMonth(from.getUTCMonth() - 1)
    return { from, to: now }
  }

  return null
}
