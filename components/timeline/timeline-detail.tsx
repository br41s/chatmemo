"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TimelineEntry } from "@/lib/timeline-parser"
import { countAbove, countBelow, DetailWindow } from "@/lib/timeline-filters"
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconMessage,
  IconX
} from "@tabler/icons-react"
import { FC, RefObject } from "react"
import { ConvCard } from "./timeline-cards"

interface TimelineDetailProps {
  /** Null when nothing is open; the pane shows its placeholder instead. */
  focusedIdx: number | null
  entries: TimelineEntry[]
  window: DetailWindow
  total: number
  focusedRef: RefObject<HTMLDivElement>
  onClose: () => void
  onLoadAbove: () => void
  onLoadBelow: () => void
  title: string
}

/** The right pane: reading a conversation, with its neighbours around it. */
export const TimelineDetail: FC<TimelineDetailProps> = ({
  focusedIdx,
  entries,
  window,
  total,
  focusedRef,
  onClose,
  onLoadAbove,
  onLoadBelow,
  title
}) => {
  if (focusedIdx === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <IconMessage size={32} className="opacity-30" />
        <p className="text-sm">Click a conversation to read it</p>
      </div>
    )
  }

  return (
    <>
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Back on mobile, close on desktop — same control, same handler. */}
          <button
            onClick={onClose}
            aria-label="Close conversation"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft size={17} className="sm:hidden" />
            <IconX size={15} className="hidden sm:block" />
          </button>
          <p className="truncate text-sm font-medium">{title}</p>
        </div>
        <p className="ml-[25px] text-[10px] text-muted-foreground">
          {window.start + 1}–{window.end + 1} of {total}
        </p>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-3 py-2">
          {window.start > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={onLoadAbove}
            >
              <IconArrowUp size={13} className="mr-1.5" />
              Load {countAbove(window)} more above
            </Button>
          ) : (
            <p className="py-1 text-center text-[10px] text-muted-foreground">
              ↑ Start of results
            </p>
          )}

          {entries.map((entry, index) => (
            <ConvCard
              key={entry.id}
              entry={entry}
              focused={window.start + index === focusedIdx}
              focusedRef={focusedRef}
            />
          ))}

          {window.end < total - 1 ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={onLoadBelow}
            >
              <IconArrowDown size={13} className="mr-1.5" />
              Load {countBelow(window, total)} more below
            </Button>
          ) : (
            <p className="py-1 text-center text-[10px] text-muted-foreground">
              ↓ End of results
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
