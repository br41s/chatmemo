"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import type { TimelineEntry, TimelineSource } from "@/lib/timeline-parser"
import {
  IconArrowLeft,
  IconArrowUp,
  IconArrowDown,
  IconCalendar,
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconHistory,
  IconMessage,
  IconRobot,
  IconSearch,
  IconTimeline,
  IconX
} from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<TimelineSource, string> = {
  "claude-ai": "Claude.ai",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  import: "Import",
  todo: "TODO",
  chat: "Chat",
  unknown: "Unknown"
}

const SOURCE_COLORS: Record<TimelineSource, string> = {
  "claude-ai": "bg-orange-500",
  "claude-code": "bg-violet-500",
  chatgpt: "bg-green-500",
  perplexity: "bg-teal-500",
  import: "bg-blue-500",
  todo: "bg-yellow-500",
  chat: "bg-cyan-500",
  unknown: "bg-gray-500"
}

const SOURCE_BORDER: Record<TimelineSource, string> = {
  "claude-ai": "border-l-orange-500",
  "claude-code": "border-l-violet-500",
  chatgpt: "border-l-green-500",
  perplexity: "border-l-teal-500",
  import: "border-l-blue-500",
  todo: "border-l-yellow-500",
  chat: "border-l-cyan-500",
  unknown: "border-l-gray-500"
}

function SourceIcon({ source }: { source: TimelineSource }) {
  const cls = "size-3"
  switch (source) {
    case "claude-ai":
      return <IconMessage className={cls} />
    case "claude-code":
      return <IconCode className={cls} />
    case "chatgpt":
      return <IconRobot className={cls} />
    case "perplexity":
      return <IconSearch className={cls} />
    case "todo":
      return <IconCalendar className={cls} />
    default:
      return <IconHistory className={cls} />
  }
}

// ---------------------------------------------------------------------------
// EntryCard — list mode (collapsible)
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  onClick
}: {
  entry: TimelineEntry
  onClick: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = entry.content.trim().length > 0
  const preview = entry.content.replace(/\s+/g, " ").trim().slice(0, 200)

  return (
    <div
      className={`cursor-pointer rounded-r-lg border border-l-4 bg-background transition-colors hover:bg-muted/40 ${SOURCE_BORDER[entry.source]} space-y-1.5 p-3`}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug">
            {entry.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{entry.date}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-white ${SOURCE_COLORS[entry.source]}`}
            >
              <SourceIcon source={entry.source} />
              {SOURCE_LABELS[entry.source]}
            </span>
          </div>
        </div>
        {hasContent && (
          <button
            onClick={e => {
              e.stopPropagation()
              setExpanded(v => !v)
            }}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <IconChevronUp size={14} />
            ) : (
              <IconChevronDown size={14} />
            )}
          </button>
        )}
      </div>

      {/* Content */}
      {hasContent && (
        <div className="text-xs leading-relaxed text-muted-foreground">
          {expanded ? (
            <pre
              className="whitespace-pre-wrap font-sans"
              onClick={e => e.stopPropagation()}
            >
              {entry.content}
            </pre>
          ) : (
            <p>
              {preview}
              {entry.content.length > 200 ? "…" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConvCard — conversation mode (always expanded, highlighted if focused)
// ---------------------------------------------------------------------------

const ConvCard = function ConvCard({
  entry,
  focused,
  focusedRef
}: {
  entry: TimelineEntry
  focused: boolean
  focusedRef?: React.RefObject<HTMLDivElement>
}) {
  const hasContent = entry.content.trim().length > 0

  return (
    <div
      ref={focused ? focusedRef : undefined}
      className={`rounded-r-lg border border-l-4 bg-background ${SOURCE_BORDER[entry.source]} space-y-2 p-3 ${
        focused ? "ring-2 ring-primary/40" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{entry.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{entry.date}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-white ${SOURCE_COLORS[entry.source]}`}
            >
              <SourceIcon source={entry.source} />
              {SOURCE_LABELS[entry.source]}
            </span>
            {focused && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                selected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Full content */}
      {hasContent && (
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
          {entry.content}
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source filter pill
// ---------------------------------------------------------------------------

const ALL_SOURCES: TimelineSource[] = [
  "claude-ai",
  "claude-code",
  "chatgpt",
  "perplexity",
  "import",
  "todo",
  "chat"
]

function SourcePill({
  source,
  active,
  count,
  onClick
}: {
  source: TimelineSource | "all"
  active: boolean
  count: number
  onClick: () => void
}) {
  const label = source === "all" ? "All" : SOURCE_LABELS[source]
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground"
      }`}
    >
      {label}
      <span className="opacity-60">{count}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const LOAD_STEP = 5

export function TimelineSheet() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // List filters
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [activeSource, setActiveSource] = useState<TimelineSource | "all">(
    "all"
  )

  // Conversation mode
  const [viewMode, setViewMode] = useState<"list" | "conv">("list")
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [windowStart, setWindowStart] = useState(0)
  const [windowEnd, setWindowEnd] = useState(2)
  const focusedRef = useRef<HTMLDivElement>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/timeline")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data.entries ?? [])
    } catch {
      setError("Failed to load timeline")
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setSearch("")
      setDateFrom("")
      setDateTo("")
      setActiveSource("all")
      setViewMode("list")
      loadEntries()
    }
  }

  // Reset to list view when any filter changes
  useEffect(() => {
    setViewMode("list")
  }, [search, dateFrom, dateTo, activeSource])

  // Scroll focused entry into view when entering conversation mode
  useEffect(() => {
    if (viewMode === "conv") {
      const t = setTimeout(() => {
        focusedRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        })
      }, 80)
      return () => clearTimeout(t)
    }
  }, [viewMode])

  // Filtered entries
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return entries.filter(e => {
      if (activeSource !== "all" && e.source !== activeSource) return false
      if (dateFrom && e.date < dateFrom) return false
      if (dateTo && e.date > dateTo) return false
      if (q) {
        const haystack = `${e.title} ${e.content}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [entries, search, dateFrom, dateTo, activeSource])

  // Source counts (on full unfiltered set)
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const e of entries) {
      counts[e.source] = (counts[e.source] ?? 0) + 1
    }
    return counts
  }, [entries])

  // Group filtered entries by year-month for visual separation (list mode)
  const grouped = useMemo(() => {
    const groups: {
      label: string
      entries: (TimelineEntry & { globalIdx: number })[]
    }[] = []
    let lastMonth = ""
    filtered.forEach((e, idx) => {
      const month = e.date.slice(0, 7)
      if (month !== lastMonth) {
        lastMonth = month
        const [y, m] = month.split("-")
        const label = new Date(`${y}-${m}-01`).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long"
        })
        groups.push({ label, entries: [] })
      }
      groups[groups.length - 1].entries.push({ ...e, globalIdx: idx })
    })
    return groups
  }, [filtered])

  const openConversation = (idx: number) => {
    setFocusedIdx(idx)
    setWindowStart(Math.max(0, idx - 1))
    setWindowEnd(Math.min(filtered.length - 1, idx + 1))
    setViewMode("conv")
  }

  const loadMoreAbove = () =>
    setWindowStart(prev => Math.max(0, prev - LOAD_STEP))
  const loadMoreBelow = () =>
    setWindowEnd(prev => Math.min(filtered.length - 1, prev + LOAD_STEP))

  const clearFilters = () => {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setActiveSource("all")
  }
  const hasFilters = search || dateFrom || dateTo || activeSource !== "all"

  // Entries visible in conversation mode
  const windowEntries = useMemo(
    () => filtered.slice(windowStart, windowEnd + 1),
    [filtered, windowStart, windowEnd]
  )

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button className="flex cursor-pointer flex-col items-center hover:opacity-50">
          <IconTimeline size={28} />
        </button>
      </SheetTrigger>

      <SheetContent
        side="left"
        className="flex w-[620px] max-w-full flex-col p-0"
      >
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          {viewMode === "conv" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("list")}
                className="text-muted-foreground hover:text-foreground"
              >
                <IconArrowLeft size={18} />
              </button>
              <SheetTitle className="text-base">
                {filtered[focusedIdx]?.title ?? "Conversation"}
              </SheetTitle>
            </div>
          ) : (
            <SheetTitle className="flex items-center gap-2 text-base">
              <IconTimeline size={18} />
              Conversation Timeline
            </SheetTitle>
          )}
        </SheetHeader>

        {/* ---------------------------------------------------------------- */}
        {/* Filters (list mode only)                                         */}
        {/* ---------------------------------------------------------------- */}
        {viewMode === "list" && (
          <div className="shrink-0 space-y-2.5 border-b px-4 py-3">
            {/* Search */}
            <div className="relative">
              <IconSearch
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="h-8 pl-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <IconX size={13} />
                </button>
              )}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <IconCalendar
                size={14}
                className="shrink-0 text-muted-foreground"
              />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="From"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="To"
              />
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="whitespace-nowrap text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Source filters */}
            <div className="flex flex-wrap gap-1.5">
              <SourcePill
                source="all"
                active={activeSource === "all"}
                count={sourceCounts["all"] ?? 0}
                onClick={() => setActiveSource("all")}
              />
              {ALL_SOURCES.filter(s => (sourceCounts[s] ?? 0) > 0).map(s => (
                <SourcePill
                  key={s}
                  source={s}
                  active={activeSource === s}
                  count={sourceCounts[s] ?? 0}
                  onClick={() =>
                    setActiveSource(activeSource === s ? "all" : s)
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Results summary */}
        <div className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground">
          {loading ? (
            "Loading…"
          ) : error ? (
            error
          ) : viewMode === "conv" ? (
            <>
              {windowStart + 1}–{windowEnd + 1} of {filtered.length}{" "}
              conversation
              {filtered.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </>
          ) : (
            <>
              {filtered.length} conversation
              {filtered.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* LIST MODE                                                         */}
        {/* ---------------------------------------------------------------- */}
        {viewMode === "list" && (
          <ScrollArea className="flex-1 px-4 pb-4">
            {!loading && !error && grouped.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {hasFilters
                  ? "No results match your filters."
                  : "No conversations yet."}
              </p>
            )}

            {grouped.map(group => (
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
                      onClick={() => openConversation(entry.globalIdx)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </ScrollArea>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* CONVERSATION MODE                                                 */}
        {/* ---------------------------------------------------------------- */}
        {viewMode === "conv" && (
          <ScrollArea className="flex-1 px-4 pb-4">
            <div className="space-y-3 py-2">
              {/* Load more above */}
              {windowStart > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={loadMoreAbove}
                >
                  <IconArrowUp size={13} className="mr-1.5" />
                  Load {Math.min(LOAD_STEP, windowStart)} more above
                </Button>
              ) : (
                <p className="py-1 text-center text-[10px] text-muted-foreground">
                  ↑ Start of results
                </p>
              )}

              {/* Window of entries */}
              {windowEntries.map((entry, i) => {
                const globalI = windowStart + i
                return (
                  <ConvCard
                    key={entry.id}
                    entry={entry}
                    focused={globalI === focusedIdx}
                    focusedRef={focusedRef}
                  />
                )
              })}

              {/* Load more below */}
              {windowEnd < filtered.length - 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={loadMoreBelow}
                >
                  <IconArrowDown size={13} className="mr-1.5" />
                  Load {Math.min(
                    LOAD_STEP,
                    filtered.length - 1 - windowEnd
                  )}{" "}
                  more below
                </Button>
              ) : (
                <p className="py-1 text-center text-[10px] text-muted-foreground">
                  ↓ End of results
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}
