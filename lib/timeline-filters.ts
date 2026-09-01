import type { TimelineEntry, TimelineSource } from "@/lib/timeline-parser"

// The timeline's logic, out of its 714-line component.
//
// Four `useMemo` blocks did the real work — filtering, counting, grouping by
// month, and deciding which slice of the results the detail pane shows — and
// none of them could be tested without rendering a sheet.

export interface TimelineFilters {
  search: string
  dateFrom: string
  dateTo: string
  activeSource: TimelineSource | "all"
}

export const emptyFilters: TimelineFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  activeSource: "all"
}

export function hasActiveFilters(filters: TimelineFilters): boolean {
  return Boolean(
    filters.search ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.activeSource !== "all"
  )
}

/**
 * The entries a set of filters leaves.
 *
 * Dates compare as strings because they are ISO days — `2026-03-04` sorts and
 * compares correctly without parsing, and both bounds are inclusive.
 */
export function filterEntries(
  entries: TimelineEntry[],
  filters: TimelineFilters
): TimelineEntry[] {
  const query = filters.search.toLowerCase().trim()

  return entries.filter(entry => {
    if (
      filters.activeSource !== "all" &&
      entry.source !== filters.activeSource
    ) {
      return false
    }
    if (filters.dateFrom && entry.date < filters.dateFrom) return false
    if (filters.dateTo && entry.date > filters.dateTo) return false

    if (query) {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }

    return true
  })
}

/**
 * How many entries each source contributed.
 *
 * Counted over everything loaded rather than the filtered view, so the pills
 * keep showing what selecting them would find.
 */
export function countBySource(
  entries: TimelineEntry[]
): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length }

  for (const entry of entries) {
    counts[entry.source] = (counts[entry.source] ?? 0) + 1
  }

  return counts
}

export interface TimelineGroup {
  label: string
  entries: (TimelineEntry & { globalIdx: number })[]
}

/**
 * Entries under month headings.
 *
 * `globalIdx` is the position within the filtered list, not within the group —
 * the detail pane pages through the flat list, so a group-local index would
 * open the wrong conversation.
 */
export function groupByMonth(entries: TimelineEntry[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  let lastMonth = ""

  entries.forEach((entry, index) => {
    const month = entry.date.slice(0, 7)

    if (month !== lastMonth) {
      lastMonth = month
      const [year, monthNumber] = month.split("-")
      groups.push({
        label: new Date(`${year}-${monthNumber}-01`).toLocaleDateString(
          undefined,
          { year: "numeric", month: "long" }
        ),
        entries: []
      })
    }

    groups[groups.length - 1].entries.push({ ...entry, globalIdx: index })
  })

  return groups
}

/** How many neighbours each "load more" reveals. */
export const LOAD_STEP = 5

export interface DetailWindow {
  start: number
  end: number
}

/** The slice the detail pane opens on: the conversation and one either side. */
export function initialWindow(index: number, total: number): DetailWindow {
  return {
    start: Math.max(0, index - 1),
    end: Math.min(total - 1, index + 1)
  }
}

export function extendAbove(window: DetailWindow): DetailWindow {
  return { ...window, start: Math.max(0, window.start - LOAD_STEP) }
}

export function extendBelow(window: DetailWindow, total: number): DetailWindow {
  return { ...window, end: Math.min(total - 1, window.end + LOAD_STEP) }
}

/** How many the button above or below would actually reveal. */
export function countAbove(window: DetailWindow): number {
  return Math.min(LOAD_STEP, window.start)
}

export function countBelow(window: DetailWindow, total: number): number {
  return Math.min(LOAD_STEP, total - 1 - window.end)
}
