"use client"

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
import { TimelineActivity } from "./timeline-activity"
import { TimelineDetail } from "./timeline-detail"
import { TimelineList } from "./timeline-list"
import { useTimelineEntries } from "./use-timeline-entries"

/**
 * The conversation timeline, as a page.
 *
 * It was a sheet that slid over the chat, 860px wide at most, opened from
 * the bottom of the rail. It is a page now: the whole history month by
 * month at the top, and the list and the reader side by side below, with
 * the room a real archive needs.
 *
 * The filtering, counting, grouping and window arithmetic are in
 * lib/timeline-filters.ts, where they can be tested without rendering.
 */
export function TimelineView() {
  const [filters, setFilters] = useState<TimelineFilters>(emptyFilters)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [window, setWindow] = useState(() => initialWindow(0, 3))
  const [activeMonth, setActiveMonth] = useState<string | null>(null)
  const focusedRef = useRef<HTMLDivElement>(null)
  const timeline = useTimelineEntries()

  useEffect(() => {
    timeline.load()
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A conversation open behind a filter that no longer matches it would be
  // read from the wrong position in the list.
  useEffect(() => {
    setFocusedIdx(null)
  }, [filters])

  // The chart's month is only a way of setting the date filter; editing the
  // dates by hand lets go of it.
  useEffect(() => {
    if (activeMonth === null) return
    const [from, to] = [filters.dateFrom, filters.dateTo]
    if (!from.startsWith(activeMonth) || !to.startsWith(activeMonth)) {
      setActiveMonth(null)
    }
  }, [filters.dateFrom, filters.dateTo, activeMonth])

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

  const pickMonth = (
    month: string | null,
    bounds: { from: string; to: string } | null
  ) => {
    setActiveMonth(month)
    setFilters({
      ...filters,
      dateFrom: bounds?.from ?? "",
      dateTo: bounds?.to ?? ""
    })
    // The month may lie past what the list has loaded so far.
    if (bounds) {
      void timeline.loadUntil(
        bounds.from,
        timeline.entries,
        timeline.nextOffset
      )
    }
  }

  const hasDetail = focusedIdx !== null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-4 pb-2 pt-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <IconTimeline size={18} className="text-brand" />
          Timeline
        </h1>
        <div className="mt-2">
          <TimelineActivity activeMonth={activeMonth} onPickMonth={pickMonth} />
        </div>
      </header>

      {/*
        Mobile: one column, showing the list or the conversation.
        Desktop: both, side by side.
      */}
      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 flex-col ${
            hasDetail ? "hidden sm:flex" : "flex"
          } w-full sm:w-[360px] sm:shrink-0 sm:border-r`}
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
          className={`flex min-h-0 flex-1 flex-col ${
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
      </div>
    </div>
  )
}
