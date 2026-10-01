import type { MemoryEntryReport } from "@/lib/memory-report"
import { cn } from "@/lib/utils"
import { FC } from "react"
import { SOURCE_LABELS, SOURCE_TONES } from "../timeline/timeline-sources"

interface MemorySourceChipProps {
  source: MemoryEntryReport["source"]
  /** Shown after the source's dot; the source name when omitted. */
  children?: React.ReactNode
  className?: string
  title?: string
}

/**
 * A small pill in a source's colour.
 *
 * The chat, the empty state and the memory panel all name where a memory
 * came from, and they must agree with the timeline about what colour that
 * is — one palette, read from the same record. The source is always named
 * as well: in the chip's own text, or for a screen reader and on hover when
 * the text is a conversation title.
 */

// A `claude` row may be a bookmarklet save or a bulk import, so here it is
// just "Claude". Claude Code sessions have a source, and a chip, of their own.
const CHIP_LABELS: Partial<Record<MemoryEntryReport["source"], string>> = {
  "claude-ai": "Claude"
}
export const MemorySourceChip: FC<MemorySourceChipProps> = ({
  source,
  children,
  className,
  title
}) => {
  const label = CHIP_LABELS[source] ?? SOURCE_LABELS[source]
  return (
    <span
      title={title ? `${label} · ${title}` : label}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        SOURCE_TONES[source].badge,
        className
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children && <span className="sr-only">{label}: </span>}
      <span className="truncate">{children ?? label}</span>
    </span>
  )
}
