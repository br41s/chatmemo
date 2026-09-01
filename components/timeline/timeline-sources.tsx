"use client"

import type { TimelineSource } from "@/lib/timeline-parser"
import {
  IconCalendar,
  IconCode,
  IconHistory,
  IconMessage,
  IconRobot,
  IconSearch
} from "@tabler/icons-react"

// Which provider a memory came from, and how it is coloured.
//
// The palette is categorical rather than semantic — a Perplexity teal is not a
// "success" — so it sits outside the status tokens on purpose. See the note in
// globals.css.

export const SOURCE_LABELS: Record<TimelineSource, string> = {
  "claude-ai": "Claude.ai",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  import: "Import",
  todo: "TODO",
  chat: "Chat",
  unknown: "Unknown"
}

// One record rather than two parallel ones: the badge and the left border are
// the same decision, and separate maps meant a new source could get a badge
// and no border. The values are theme tokens, so the palette tunes per theme
// instead of being a light-theme palette shown on both — the badges used to be
// white text on a fixed 500-level fill, which in dark mode was white on a
// colour bright enough to disappear against it.
export const SOURCE_TONES: Record<
  TimelineSource,
  { badge: string; border: string }
> = {
  "claude-ai": {
    badge:
      "bg-[hsl(var(--source-claude-ai)/0.15)] text-[hsl(var(--source-claude-ai))]",
    border: "border-l-[hsl(var(--source-claude-ai))]"
  },
  "claude-code": {
    badge:
      "bg-[hsl(var(--source-claude-code)/0.15)] text-[hsl(var(--source-claude-code))]",
    border: "border-l-[hsl(var(--source-claude-code))]"
  },
  chatgpt: {
    badge:
      "bg-[hsl(var(--source-chatgpt)/0.15)] text-[hsl(var(--source-chatgpt))]",
    border: "border-l-[hsl(var(--source-chatgpt))]"
  },
  perplexity: {
    badge:
      "bg-[hsl(var(--source-perplexity)/0.15)] text-[hsl(var(--source-perplexity))]",
    border: "border-l-[hsl(var(--source-perplexity))]"
  },
  import: {
    badge:
      "bg-[hsl(var(--source-import)/0.15)] text-[hsl(var(--source-import))]",
    border: "border-l-[hsl(var(--source-import))]"
  },
  todo: {
    badge: "bg-[hsl(var(--source-todo)/0.15)] text-[hsl(var(--source-todo))]",
    border: "border-l-[hsl(var(--source-todo))]"
  },
  chat: {
    badge: "bg-[hsl(var(--source-chat)/0.15)] text-[hsl(var(--source-chat))]",
    border: "border-l-[hsl(var(--source-chat))]"
  },
  unknown: {
    badge:
      "bg-[hsl(var(--source-unknown)/0.15)] text-[hsl(var(--source-unknown))]",
    border: "border-l-[hsl(var(--source-unknown))]"
  }
}

export function SourceIcon({ source }: { source: TimelineSource }) {
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
// EntryCard — list panel (collapsible preview, clickable)
// ---------------------------------------------------------------------------

export const ALL_SOURCES: TimelineSource[] = [
  "claude-ai",
  "claude-code",
  "chatgpt",
  "perplexity",
  "import",
  "todo",
  "chat"
]

export function SourcePill({
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
