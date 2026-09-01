import type { TimelineEntry } from "../../lib/timeline-parser"
import {
  countAbove,
  countBelow,
  countBySource,
  emptyFilters,
  extendAbove,
  extendBelow,
  filterEntries,
  groupByMonth,
  hasActiveFilters,
  initialWindow,
  LOAD_STEP
} from "../../lib/timeline-filters"

const entry = (overrides: Partial<TimelineEntry>): TimelineEntry =>
  ({
    id: "e1",
    date: "2026-03-04",
    source: "chatgpt",
    title: "Flights to Phuket",
    content: "We compared three routes.",
    ...overrides
  }) as TimelineEntry

describe("filterEntries", () => {
  const entries = [
    entry({ id: "a", date: "2026-01-10", source: "chatgpt", title: "Taxes" }),
    entry({
      id: "b",
      date: "2026-02-20",
      source: "claude-ai",
      title: "Phuket",
      content: "beaches"
    }),
    entry({ id: "c", date: "2026-03-04", source: "chatgpt", title: "Rent" })
  ]

  it("keeps everything when nothing is set", () => {
    expect(filterEntries(entries, emptyFilters)).toHaveLength(3)
  })

  it("filters by source", () => {
    expect(
      filterEntries(entries, { ...emptyFilters, activeSource: "claude-ai" })
    ).toEqual([entries[1]])
  })

  it("treats both ends of the date range as inclusive", () => {
    const inRange = filterEntries(entries, {
      ...emptyFilters,
      dateFrom: "2026-01-10",
      dateTo: "2026-02-20"
    })

    expect(inRange.map(e => e.id)).toEqual(["a", "b"])
  })

  it("searches the title and the content together", () => {
    expect(
      filterEntries(entries, { ...emptyFilters, search: "beaches" })
    ).toEqual([entries[1]])
    expect(
      filterEntries(entries, { ...emptyFilters, search: "phuket" })
    ).toEqual([entries[1]])
  })

  it("ignores case and surrounding space in the query", () => {
    expect(
      filterEntries(entries, { ...emptyFilters, search: "  TAXES " })
    ).toEqual([entries[0]])
  })

  it("applies every filter at once", () => {
    expect(
      filterEntries(entries, {
        search: "rent",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
        activeSource: "chatgpt"
      })
    ).toEqual([entries[2]])
  })
})

describe("hasActiveFilters", () => {
  it("is false only for the empty set", () => {
    expect(hasActiveFilters(emptyFilters)).toBe(false)
    expect(hasActiveFilters({ ...emptyFilters, search: "a" })).toBe(true)
    expect(hasActiveFilters({ ...emptyFilters, dateTo: "2026-01-01" })).toBe(
      true
    )
    expect(hasActiveFilters({ ...emptyFilters, activeSource: "chatgpt" })).toBe(
      true
    )
  })
})

describe("countBySource", () => {
  it("counts each source and the total", () => {
    const counts = countBySource([
      entry({ source: "chatgpt" }),
      entry({ source: "chatgpt" }),
      entry({ source: "claude-ai" })
    ])

    expect(counts).toEqual({ all: 3, chatgpt: 2, "claude-ai": 1 })
  })

  it("reports an empty timeline as zero rather than nothing", () => {
    expect(countBySource([])).toEqual({ all: 0 })
  })
})

describe("groupByMonth", () => {
  it("starts a group at each month boundary", () => {
    const groups = groupByMonth([
      entry({ id: "a", date: "2026-03-20" }),
      entry({ id: "b", date: "2026-03-04" }),
      entry({ id: "c", date: "2026-02-28" })
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].entries.map(e => e.id)).toEqual(["a", "b"])
    expect(groups[1].entries.map(e => e.id)).toEqual(["c"])
  })

  it("numbers entries by their place in the whole list, not the group", () => {
    // The detail pane pages through the flat list; a group-local index would
    // open the wrong conversation.
    const groups = groupByMonth([
      entry({ id: "a", date: "2026-03-20" }),
      entry({ id: "b", date: "2026-02-28" }),
      entry({ id: "c", date: "2026-02-01" })
    ])

    expect(groups[1].entries.map(e => e.globalIdx)).toEqual([1, 2])
  })

  it("starts a new group when a month repeats after a gap", () => {
    // Grouping follows the order it is given rather than collecting by month,
    // so out-of-order input produces separate headings rather than a silently
    // reordered list.
    const groups = groupByMonth([
      entry({ id: "a", date: "2026-03-20" }),
      entry({ id: "b", date: "2026-02-28" }),
      entry({ id: "c", date: "2026-03-01" })
    ])

    expect(groups).toHaveLength(3)
  })

  it("returns nothing for nothing", () => {
    expect(groupByMonth([])).toEqual([])
  })
})

describe("the detail window", () => {
  it("opens on the conversation and one either side", () => {
    expect(initialWindow(5, 20)).toEqual({ start: 4, end: 6 })
  })

  it("does not run off either end", () => {
    expect(initialWindow(0, 20)).toEqual({ start: 0, end: 1 })
    expect(initialWindow(19, 20)).toEqual({ start: 18, end: 19 })
  })

  it("handles a single result", () => {
    expect(initialWindow(0, 1)).toEqual({ start: 0, end: 0 })
  })

  it("extends by a step, stopping at the edges", () => {
    expect(extendAbove({ start: 10, end: 12 })).toEqual({
      start: 10 - LOAD_STEP,
      end: 12
    })
    expect(extendAbove({ start: 2, end: 4 })).toEqual({ start: 0, end: 4 })
    expect(extendBelow({ start: 0, end: 1 }, 20)).toEqual({
      start: 0,
      end: 1 + LOAD_STEP
    })
    expect(extendBelow({ start: 0, end: 18 }, 20)).toEqual({
      start: 0,
      end: 19
    })
  })

  it("says how many a button would actually reveal", () => {
    // The label promises a number; near an edge it is smaller than the step.
    expect(countAbove({ start: 10, end: 12 })).toBe(LOAD_STEP)
    expect(countAbove({ start: 2, end: 4 })).toBe(2)
    expect(countBelow({ start: 0, end: 1 }, 20)).toBe(LOAD_STEP)
    expect(countBelow({ start: 0, end: 17 }, 20)).toBe(2)
  })
})
