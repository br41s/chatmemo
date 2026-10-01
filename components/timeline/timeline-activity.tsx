"use client"

import type { MemoryDbSource } from "@/lib/memory-stats"
import { ActivityMonth, monthBounds, monthLabel } from "@/lib/timeline-activity"
import { cn } from "@/lib/utils"
import { FC, useEffect, useId, useRef, useState } from "react"
import { MemorySourceChip } from "../memory/memory-source-chip"

/**
 * The stack order, bottom to top. Chosen so that no two neighbours are the
 * green and the teal, or the two Claude oranges: those are the closest pairs
 * in the palette, and the validator only clears them with something else in
 * between.
 */
const STACK: Array<{
  source: MemoryDbSource
  label: string
  chip: "claude-ai" | "claude-code" | "chatgpt" | "chat" | "perplexity"
  fill: string
}> = [
  {
    source: "claude",
    label: "Claude",
    chip: "claude-ai",
    fill: "hsl(var(--source-claude-ai))"
  },
  {
    source: "chatgpt",
    label: "ChatGPT",
    chip: "chatgpt",
    fill: "hsl(var(--source-chatgpt))"
  },
  // The chart's own rust in both modes: see the note in globals.css.
  {
    source: "claude_code",
    label: "Claude Code",
    chip: "claude-code",
    fill: "hsl(var(--chart-claude-code))"
  },
  {
    source: "other",
    label: "Chat",
    chip: "chat",
    fill: "hsl(var(--source-chat))"
  },
  // The chart's own teal in light mode: see the note in globals.css.
  {
    source: "perplexity",
    label: "Perplexity",
    chip: "perplexity",
    fill: "hsl(var(--chart-perplexity))"
  }
]

interface TimelineActivityProps {
  /** `YYYY-MM` of the month the list is filtered to, if any. */
  activeMonth: string | null
  /** Filter the list to a month, or clear the filter with null. */
  onPickMonth: (
    month: string | null,
    bounds: { from: string; to: string } | null
  ) => void
}

/**
 * Memory month by month, stacked by source.
 *
 * The timeline lists conversations one at a time; this is the whole history
 * in one look — when a source was busy, the gaps, the growth — and each bar
 * is a button that filters the list to its month. A screen reader gets the
 * same numbers as a table.
 */
export const TimelineActivity: FC<TimelineActivityProps> = ({
  activeMonth,
  onPickMonth
}) => {
  const [months, setMonths] = useState<ActivityMonth[] | null>(null)
  const [error, setError] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const plotRef = useRef<HTMLDivElement>(null)
  const tableId = useId()

  // How many month labels fit is a question of pixels, not of months: on a
  // phone the same history gets a label a year.
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [months])

  useEffect(() => {
    let cancelled = false
    fetch("/api/timeline/activity")
      .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(data => {
        if (!cancelled) setMonths(data.months ?? [])
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const peak = Math.max(1, ...(months ?? []).map(m => m.total))
  const totals = STACK.map(({ source }) => ({
    source,
    total: (months ?? []).reduce((sum, m) => sum + m.counts[source], 0)
  }))
  const shown = hovered ?? activeMonth
  const shownMonth = months?.find(m => m.month === shown) ?? null
  // Enough labels to orient by, never one per bar, and never more than the
  // width holds at about 72px each.
  const maxLabels = Math.max(2, Math.floor((width || 600) / 72))
  const labelEvery = months
    ? Math.max(1, Math.ceil(months.length / maxLabels))
    : 1

  return (
    <figure aria-describedby={tableId} className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption className="text-sm font-medium">
          Memory over time
        </figcaption>
        <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
          {STACK.map(({ source, chip, label }) => {
            const total = totals.find(t => t.source === source)?.total ?? 0
            return total > 0 ? (
              <li key={source}>
                <MemorySourceChip source={chip}>
                  {label}{" "}
                  <span className="tabular-nums opacity-70">
                    {total.toLocaleString()}
                  </span>
                </MemorySourceChip>
              </li>
            ) : null
          })}
        </ul>
      </div>

      <div className="mt-2 h-[112px]">
        {months === null && !error && (
          <div className="flex h-full items-end gap-[3px] pb-5">
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className="flex-1 animate-pulse rounded-t-[4px] bg-muted"
                style={{ height: `${25 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        )}
        {error && (
          <p className="pt-6 text-center text-sm text-muted-foreground">
            The chart could not be loaded.
          </p>
        )}
        {months && months.length === 0 && (
          <p className="pt-6 text-center text-sm text-muted-foreground">
            No memory yet.
          </p>
        )}
        {months && months.length > 0 && (
          <div ref={plotRef} className="flex h-full flex-col">
            {/* One column per month; each column a stack, bottom-up, with a
                2px gap of surface between segments and a rounded top. */}
            <div className="flex min-h-0 flex-1 items-end gap-[3px] border-b border-border">
              {months.map(({ month, counts, total }) => {
                const isActive = activeMonth === month
                const dimmed =
                  (hovered !== null && hovered !== month) ||
                  (hovered === null && activeMonth !== null && !isActive)
                const segments = STACK.filter(s => counts[s.source] > 0)
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`${monthLabel(month)}: ${total} ${
                      total === 1 ? "entry" : "entries"
                    }${segments
                      .map(s => `, ${s.label} ${counts[s.source]}`)
                      .join("")}`}
                    onMouseEnter={() => setHovered(month)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(month)}
                    onBlur={() => setHovered(null)}
                    onClick={() =>
                      onPickMonth(
                        isActive ? null : month,
                        isActive ? null : monthBounds(month)
                      )
                    }
                    className={cn(
                      "flex h-full min-w-[6px] flex-1 flex-col-reverse justify-start gap-[2px] rounded-t-[4px] pt-1 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      dimmed && "opacity-40"
                    )}
                  >
                    {total === 0 && (
                      <span
                        className="block h-px w-full bg-border"
                        aria-hidden
                      />
                    )}
                    {segments.map((s, index) => (
                      <span
                        key={s.source}
                        aria-hidden
                        className={cn(
                          "block w-full",
                          index === segments.length - 1 && "rounded-t-[4px]"
                        )}
                        style={{
                          height: `${(counts[s.source] / peak) * 100}%`,
                          backgroundColor: s.fill
                        }}
                      />
                    ))}
                  </button>
                )
              })}
            </div>
            {/* A label every few months, allowed to run past its own column:
                the columns are narrower than a month name. */}
            <div className="flex gap-[3px] pt-1 text-[11px] text-muted-foreground">
              {months.map(({ month }, index) => (
                <span
                  key={month}
                  className="min-w-[6px] flex-1 overflow-visible whitespace-nowrap"
                >
                  {index % labelEvery === 0 ? monthLabel(month) : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The hovered or chosen month, in words: the tooltip. Fixed height so
          the list below does not jump when it appears. */}
      <p
        className="mt-1 h-5 truncate text-xs text-muted-foreground"
        aria-live="polite"
      >
        {shownMonth ? (
          <>
            <span className="font-medium text-foreground">
              {monthLabel(shownMonth.month)}
            </span>{" "}
            · {shownMonth.total} {shownMonth.total === 1 ? "entry" : "entries"}
            {STACK.filter(s => shownMonth.counts[s.source] > 0).map(s => (
              <span key={s.source}>
                {" "}
                · {s.label} {shownMonth.counts[s.source]}
              </span>
            ))}
            {activeMonth === shownMonth.month && " · click to show all"}
          </>
        ) : months && months.length > 0 ? (
          "Click a month to show only its conversations."
        ) : null}
      </p>

      {months && months.length > 0 && (
        <table id={tableId} className="sr-only">
          <caption>Memory entries by month and source</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {STACK.map(s => (
                <th key={s.source} scope="col">
                  {s.label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month}>
                <th scope="row">{monthLabel(m.month)}</th>
                {STACK.map(s => (
                  <td key={s.source}>{m.counts[s.source]}</td>
                ))}
                <td>{m.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  )
}
