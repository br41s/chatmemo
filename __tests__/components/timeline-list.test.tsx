/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { Sheet } from "../../components/ui/sheet"
import { TimelineList } from "../../components/timeline/timeline-list"
import { emptyFilters, TimelineGroup } from "../../lib/timeline-filters"
import type { TimelineEntry } from "../../lib/timeline-parser"

// The timeline is the surface REF-04 split, and `lib/timeline-filters.ts` is
// unit-tested on its own. What is untested is the wiring: whether a control
// reports the change the filter functions expect, and whether the pane tells
// the user the truth about what it is showing. Both are the kind of defect a
// pure-function test cannot see.

const entry = (
  overrides: Partial<TimelineEntry & { globalIdx: number }> & { id: string }
): TimelineEntry & { globalIdx: number } => ({
  summaryId: overrides.id,
  date: "2026-03-01",
  title: `Conversation ${overrides.id}`,
  content: "",
  source: "chat",
  importedAt: "2026-03-01T00:00:00.000Z",
  globalIdx: 0,
  ...overrides
})

const group = (
  label: string,
  entries: (TimelineEntry & { globalIdx: number })[]
): TimelineGroup => ({
  label,
  entries
})

function renderList(
  overrides: Partial<Parameters<typeof TimelineList>[0]> = {}
) {
  const props = {
    filters: emptyFilters,
    onFiltersChange: jest.fn(),
    sourceCounts: { all: 2, chat: 2 },
    groups: [
      group("March 2026", [
        entry({ id: "a", globalIdx: 0 }),
        entry({ id: "b", globalIdx: 1 })
      ])
    ],
    resultCount: 2,
    loadedCount: 2,
    focusedIdx: null,
    onOpenConversation: jest.fn(),
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    onLoadMore: jest.fn(),
    ...overrides
  }
  // The pane's heading is a `SheetTitle`, which needs the sheet's dialog
  // context; in the app it always has one.
  render(
    <Sheet open>
      <TimelineList {...props} />
    </Sheet>
  )
  return props
}

describe("TimelineList filters", () => {
  it("reports a search term without dropping the other filters", () => {
    // `set` spreads the current filters; a regression to a bare object would
    // silently reset the date range every keystroke.
    const { onFiltersChange } = renderList({
      filters: { ...emptyFilters, dateFrom: "2026-01-01" }
    })

    fireEvent.change(screen.getByPlaceholderText("Search conversations…"), {
      target: { value: "supabase" }
    })

    expect(onFiltersChange).toHaveBeenCalledWith({
      search: "supabase",
      dateFrom: "2026-01-01",
      dateTo: "",
      activeSource: "all"
    })
  })

  it("reports both ends of the date range separately", () => {
    const { onFiltersChange } = renderList()

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-01-01" }
    })
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: "2026-01-01", dateTo: "" })
    )

    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-02-01" }
    })
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateTo: "2026-02-01" })
    )
  })

  it("turns a source pill off when it is already the active one", () => {
    // Clicking the active source has to be an escape hatch back to "all",
    // otherwise a filtered timeline can only be cleared from the Clear link.
    const { onFiltersChange } = renderList({
      filters: { ...emptyFilters, activeSource: "chat" }
    })

    fireEvent.click(screen.getByRole("button", { name: /Chat/ }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ activeSource: "all" })
    )
  })

  it("hides source pills for sources with nothing in them", () => {
    renderList({ sourceCounts: { all: 2, chat: 2, chatgpt: 0 } })

    expect(screen.queryByRole("button", { name: /ChatGPT/ })).toBeNull()
  })

  it("offers no way to clear filters when none are set", () => {
    renderList()

    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
    expect(screen.queryByLabelText("Clear search")).toBeNull()
  })

  it("resets every filter at once from the Clear link", () => {
    const { onFiltersChange } = renderList({
      filters: {
        search: "supabase",
        dateFrom: "2026-01-01",
        dateTo: "2026-02-01",
        activeSource: "chat"
      }
    })

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))

    expect(onFiltersChange).toHaveBeenCalledWith(emptyFilters)
  })
})

describe("TimelineList status line", () => {
  it("says how many conversations matched, and that they are filtered", () => {
    renderList({
      resultCount: 1,
      filters: { ...emptyFilters, search: "supabase" }
    })

    expect(screen.getByText("1 conversation (filtered)")).toBeTruthy()
  })

  it("does not call an unfiltered list filtered", () => {
    renderList({ resultCount: 2 })

    expect(screen.getByText("2 conversations")).toBeTruthy()
  })

  it("shows the error instead of a count when the load failed", () => {
    // A count of zero next to a failed request reads as "you have nothing",
    // which is a different and much worse message than "this did not load".
    renderList({ error: "Timeline failed to load", resultCount: 0, groups: [] })

    expect(screen.getByText("Timeline failed to load")).toBeTruthy()
    expect(screen.queryByText("0 conversations")).toBeNull()
    expect(screen.queryByText("No conversations yet.")).toBeNull()
  })

  it("tells an empty result from an empty timeline", () => {
    renderList({ groups: [], resultCount: 0 })
    expect(screen.getByText("No conversations yet.")).toBeTruthy()

    screen.getByText("No conversations yet.").remove()

    renderList({
      groups: [],
      resultCount: 0,
      filters: { ...emptyFilters, search: "nothing matches this" }
    })
    expect(screen.getByText("No results match your filters.")).toBeTruthy()
  })
})

describe("TimelineList paging", () => {
  it("opens the conversation by its position in the flat list", () => {
    // globalIdx, not the index within the month group: the detail pane pages
    // through the filtered list, so a group-local index opens the wrong one.
    const { onOpenConversation } = renderList({
      groups: [
        group("March 2026", [entry({ id: "a", globalIdx: 7 })]),
        group("February 2026", [entry({ id: "b", globalIdx: 8 })])
      ]
    })

    fireEvent.click(screen.getByText("Conversation b"))

    expect(onOpenConversation).toHaveBeenCalledWith(8)
  })

  it("says that filters only apply to what has been loaded", () => {
    // Filtering a paginated list is a partial answer, and saying so is the
    // difference between a limitation and a bug report.
    renderList({ hasMore: true, loadedCount: 50 })

    expect(
      screen.getByText(/Filters apply to the 50 loaded so far/)
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Load older conversations" })
    ).toBeTruthy()
  })

  it("cannot ask for another page while one is in flight", () => {
    renderList({ hasMore: true, loadingMore: true })

    expect(screen.getByRole("button", { name: "Loading…" })).toHaveProperty(
      "disabled",
      true
    )
  })

  it("offers no load-more button when there is nothing older", () => {
    renderList({ hasMore: false })

    expect(screen.queryByRole("button", { name: /Load older/ })).toBeNull()
  })
})
