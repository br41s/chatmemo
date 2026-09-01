"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SheetTitle } from "@/components/ui/sheet"
import { RowListSkeleton } from "@/components/ui/skeletons"
import type { TimelineSource } from "@/lib/timeline-parser"
import {
  hasActiveFilters,
  TimelineFilters,
  TimelineGroup
} from "@/lib/timeline-filters"
import {
  IconCalendar,
  IconSearch,
  IconTimeline,
  IconX
} from "@tabler/icons-react"
import { FC } from "react"
import { EntryCard } from "./timeline-cards"
import { ALL_SOURCES, SourcePill } from "./timeline-sources"

interface TimelineListProps {
  filters: TimelineFilters
  onFiltersChange: (filters: TimelineFilters) => void
  sourceCounts: Record<string, number>
  groups: TimelineGroup[]
  resultCount: number
  loadedCount: number
  focusedIdx: number | null
  onOpenConversation: (index: number) => void
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
}

/** The left pane: what to look for, and what was found. */
export const TimelineList: FC<TimelineListProps> = ({
  filters,
  onFiltersChange,
  sourceCounts,
  groups,
  resultCount,
  loadedCount,
  focusedIdx,
  onOpenConversation,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore
}) => {
  const set = <K extends keyof TimelineFilters>(
    key: K,
    value: TimelineFilters[K]
  ) => onFiltersChange({ ...filters, [key]: value })

  const filtered = hasActiveFilters(filters)

  const clearFilters = () =>
    onFiltersChange({
      search: "",
      dateFrom: "",
      dateTo: "",
      activeSource: "all"
    })

  const toggleSource = (source: TimelineSource) =>
    set("activeSource", filters.activeSource === source ? "all" : source)

  return (
    <>
      <div className="shrink-0 border-b px-4 py-3">
        <SheetTitle className="flex items-center gap-2 text-base">
          <IconTimeline size={18} />
          Conversation Timeline
        </SheetTitle>
      </div>

      <div className="shrink-0 space-y-2.5 border-b px-4 py-3">
        <div className="relative">
          <IconSearch
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={filters.search}
            onChange={e => set("search", e.target.value)}
            placeholder="Search conversations…"
            className="h-8 pl-8 text-sm"
          />
          {filters.search && (
            <button
              onClick={() => set("search", "")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <IconX size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <IconCalendar size={14} className="shrink-0 text-muted-foreground" />
          <input
            type="date"
            aria-label="From date"
            value={filters.dateFrom}
            onChange={e => set("dateFrom", e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            aria-label="To date"
            value={filters.dateTo}
            onChange={e => set("dateTo", e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {filtered && (
            <button
              onClick={clearFilters}
              className="whitespace-nowrap text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <SourcePill
            source="all"
            active={filters.activeSource === "all"}
            count={sourceCounts["all"] ?? 0}
            onClick={() => set("activeSource", "all")}
          />
          {ALL_SOURCES.filter(source => (sourceCounts[source] ?? 0) > 0).map(
            source => (
              <SourcePill
                key={source}
                source={source}
                active={filters.activeSource === source}
                count={sourceCounts[source] ?? 0}
                onClick={() => toggleSource(source)}
              />
            )
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground">
        {loading
          ? "Loading…"
          : error
            ? error
            : `${resultCount} conversation${resultCount !== 1 ? "s" : ""}${
                filtered ? " (filtered)" : ""
              }`}
      </div>

      <ScrollArea className="flex-1 px-3 pb-4">
        {loading && !error && (
          <div className="pt-2">
            <RowListSkeleton rows={6} label="Loading the timeline" />
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filtered
              ? "No results match your filters."
              : "No conversations yet."}
          </p>
        )}

        {groups.map(group => (
          <div key={group.label} className="mb-4">
            <div className="sticky top-0 z-10 mb-2 bg-background/80 py-1.5 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
            </div>
            <div className="space-y-2">
              {group.entries.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  active={entry.globalIdx === focusedIdx}
                  onClick={() => onOpenConversation(entry.globalIdx)}
                />
              ))}
            </div>
          </div>
        ))}

        {!loading && !error && hasMore && (
          <div className="flex flex-col items-center gap-1.5 py-4">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading…" : "Load older conversations"}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Filters apply to the {loadedCount} loaded so far
            </p>
          </div>
        )}
      </ScrollArea>
    </>
  )
}
