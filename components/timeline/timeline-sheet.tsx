"use client"

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  countBySource,
  emptyFilters,
  extendAbove,
  extendBelow,
  filterEntries,
  groupByMonth,
  initialWindow,
  TimelineFilters
} from "@/lib/timeline-filters"
import { IconTimeline } from "@tabler/icons-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { TimelineDetail } from "./timeline-detail"
import { TimelineList } from "./timeline-list"
import { useTimelineEntries } from "./use-timeline-entries"

/**
 * The conversation timeline.
 *
 * This was 714 lines: the source palette, two card components, the filter
 * pills, the loading, the filtering, the grouping, the paging, and both panes.
 * What is left is the sheet, the two panes side by side, and the state that
 * genuinely spans them — which conversation is open, and which slice of the
 * results is being read.
 *
 * The filtering, counting, grouping and window arithmetic are in
 * lib/timeline-filters.ts, where they can be tested without rendering a sheet.
 */
export function TimelineSheet() {
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState<TimelineFilters>(emptyFilters)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [window, setWindow] = useState(() => initialWindow(0, 3))
  const focusedRef = useRef<HTMLDivElement>(null)

  const timeline = useTimelineEntries()

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setFilters(emptyFilters)
      setFocusedIdx(null)
      timeline.load()
    }
  }

  // A conversation open behind a filter that no longer matches it would be
  // read from the wrong position in the list.
  useEffect(() => {
    setFocusedIdx(null)
  }, [filters])

  useEffect(() => {
    if (focusedIdx === null) return

    const timer = setTimeout(() => {
      focusedRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      })
    }, 80)

    return () => clearTimeout(timer)
  }, [focusedIdx])

  const filtered = useMemo(
    () => filterEntries(timeline.entries, filters),
    [timeline.entries, filters]
  )
  const sourceCounts = useMemo(
    () => countBySource(timeline.entries),
    [timeline.entries]
  )
  const groups = useMemo(() => groupByMonth(filtered), [filtered])
  const windowEntries = useMemo(
    () => filtered.slice(window.start, window.end + 1),
    [filtered, window]
  )

  const openConversation = (index: number) => {
    setFocusedIdx(index)
    setWindow(initialWindow(index, filtered.length))
  }

  const hasDetail = focusedIdx !== null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          aria-label="Conversation timeline"
          className="flex cursor-pointer flex-col items-center hover:opacity-50"
        >
          <IconTimeline size={28} />
        </button>
      </SheetTrigger>

      {/*
        Mobile: one column, showing the list or the conversation.
        Desktop: both, side by side.
      */}
      <SheetContent
        side="left"
        className="flex w-full flex-row p-0 sm:w-[860px] sm:max-w-[90vw]"
      >
        <div
          className={`flex flex-col ${
            hasDetail ? "hidden sm:flex" : "flex"
          } w-full sm:w-[340px] sm:shrink-0 sm:border-r`}
        >
          <TimelineList
            filters={filters}
            onFiltersChange={setFilters}
            sourceCounts={sourceCounts}
            groups={groups}
            resultCount={filtered.length}
            loadedCount={timeline.entries.length}
            focusedIdx={focusedIdx}
            onOpenConversation={openConversation}
            loading={timeline.loading}
            loadingMore={timeline.loadingMore}
            error={timeline.error}
            hasMore={timeline.nextOffset !== null}
            onLoadMore={timeline.loadMore}
          />
        </div>

        <div
          className={`flex flex-1 flex-col ${
            hasDetail ? "flex" : "hidden sm:flex"
          }`}
        >
          <TimelineDetail
            focusedIdx={focusedIdx}
            entries={windowEntries}
            window={window}
            total={filtered.length}
            focusedRef={focusedRef}
            title={
              focusedIdx !== null
                ? filtered[focusedIdx]?.title ?? "Conversation"
                : ""
            }
            onClose={() => setFocusedIdx(null)}
            onLoadAbove={() => setWindow(extendAbove)}
            onLoadBelow={() =>
              setWindow(current => extendBelow(current, filtered.length))
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
