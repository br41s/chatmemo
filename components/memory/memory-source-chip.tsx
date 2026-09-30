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
 * is — one palette, read from the same record.
 */
export const MemorySourceChip: FC<MemorySourceChipProps> = ({
  source,
  children,
  className,
  title
}) => (
  <span
    title={title}
    className={cn(
      "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
      SOURCE_TONES[source].badge,
      className
    )}
  >
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
    <span className="truncate">{children ?? SOURCE_LABELS[source]}</span>
  </span>
)
