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
import { useCallback, useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<TimelineSource, string> = {
  "claude-ai": "Claude.ai",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  import: "Import",
  todo: "TODO",
  chat: "Chat",
  unknown: "Unknown"
}

const SOURCE_COLORS: Record<TimelineSource, string> = {
  "claude-ai": "bg-orange-500",
  "claude-code": "bg-violet-500",
  chatgpt: "bg-green-500",
  import: "bg-blue-500",
  todo: "bg-yellow-500",
  chat: "bg-teal-500",
  unknown: "bg-gray-500"
}

const SOURCE_BORDER: Record<TimelineSource, string> = {
  "claude-ai": "border-l-orange-500",
  "claude-code": "border-l-violet-500",
  chatgpt: "border-l-green-500",
  import: "border-l-blue-500",
  todo: "border-l-yellow-500",
  chat: "border-l-teal-500",
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
    case "todo":
      return <IconCalendar className={cls} />
    default:
      return <IconHistory className={cls} />
  }
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------

function EntryCard({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = entry.content.trim().length > 0
  const preview = entry.content.replace(/\s+/g, " ").trim().slice(0, 200)

  return (
    <div
      className={`rounded-r-lg border border-l-2 border-l-4 bg-background ${SOURCE_BORDER[entry.source]} space-y-1.5 p-3`}
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
            onClick={() => setExpanded(v => !v)}
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
            <pre className="whitespace-pre-wrap font-sans">{entry.content}</pre>
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
// Source filter pill
// ---------------------------------------------------------------------------

const ALL_SOURCES: TimelineSource[] = [
  "claude-ai",
  "claude-code",
  "chatgpt",
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

export function TimelineSheet() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [activeSource, setActiveSource] = useState<TimelineSource | "all">(
    "all"
  )

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
      loadEntries()
    }
  }

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

  // Group filtered entries by year-month for visual separation
  const grouped = useMemo(() => {
    const groups: { label: string; entries: TimelineEntry[] }[] = []
    let lastMonth = ""
    for (const e of filtered) {
      const month = e.date.slice(0, 7) // YYYY-MM
      if (month !== lastMonth) {
        lastMonth = month
        const [y, m] = month.split("-")
        const label = new Date(`${y}-${m}-01`).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long"
        })
        groups.push({ label, entries: [] })
      }
      groups[groups.length - 1].entries.push(e)
    }
    return groups
  }, [filtered])

  const clearFilters = () => {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setActiveSource("all")
  }
  const hasFilters = search || dateFrom || dateTo || activeSource !== "all"

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
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <IconTimeline size={18} />
            Conversation Timeline
          </SheetTitle>
        </SheetHeader>

        {/* Filters */}
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
                onClick={() => setActiveSource(activeSource === s ? "all" : s)}
              />
            ))}
          </div>
        </div>

        {/* Results summary */}
        <div className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : error
              ? error
              : `${filtered.length} conversation${filtered.length !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : ""}`}
        </div>

        {/* Timeline list */}
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
                  <EntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
