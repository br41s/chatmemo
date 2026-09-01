"use client"

import { Button } from "@/components/ui/button"
import type { TimelineEntry } from "@/lib/timeline-parser"
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import { RefObject, useState } from "react"
import { SOURCE_LABELS, SOURCE_TONES, SourceIcon } from "./timeline-sources"

// A conversation as a row in the list, and as a card in the reading pane.

export function EntryCard({
  entry,
  active,
  onClick
}: {
  entry: TimelineEntry
  active: boolean
  onClick: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = entry.content.trim().length > 0
  const preview = entry.content.replace(/\s+/g, " ").trim().slice(0, 160)

  return (
    <div
      className={`cursor-pointer rounded-r-lg border border-l-4 transition-colors ${SOURCE_TONES[entry.source].border} space-y-1.5 p-3 ${
        active
          ? "bg-muted/60 ring-1 ring-primary/30"
          : "bg-background hover:bg-muted/40"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug">
            {entry.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{entry.date}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TONES[entry.source].badge}`}
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

      {/* Inline preview — only on mobile (hidden on desktop, right panel handles it) */}
      {hasContent && expanded && (
        <div
          className="text-xs leading-relaxed text-muted-foreground sm:hidden"
          onClick={e => e.stopPropagation()}
        >
          <pre className="whitespace-pre-wrap font-sans">{entry.content}</pre>
        </div>
      )}
      {hasContent && !expanded && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {preview}
          {entry.content.length > 160 ? "…" : ""}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConvCard — detail panel (always fully expanded)
// ---------------------------------------------------------------------------

export function ConvCard({
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
      className={`rounded-r-lg border border-l-4 bg-background ${SOURCE_TONES[entry.source].border} space-y-2 p-3 ${
        focused ? "ring-2 ring-primary/40" : "opacity-80"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{entry.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{entry.date}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TONES[entry.source].badge}`}
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
