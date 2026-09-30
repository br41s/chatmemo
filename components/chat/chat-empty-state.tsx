"use client"

import { Brand } from "@/components/ui/brand"
import {
  describeNewest,
  memoryConstellation,
  MemoryStats
} from "@/lib/memory-stats"
import { useCallback, useEffect, useState } from "react"
import { MemorySourceChip } from "../memory/memory-source-chip"

interface ChatEmptyStateProps {
  /** Puts a suggestion into the composer. */
  onSuggestion: (text: string) => void
}

/**
 * What a new chat opens on.
 *
 * It used to be a logo and an input. Nothing said the product had a memory, or
 * that asking about a past conversation would work, or that full transcripts
 * could be recovered — and full recovery only fires on a hardcoded phrase list,
 * so a person could only hit it by accident.
 *
 * The count was the first honest version of the pitch. This is the second:
 * where the memory came from, in the timeline's colours, and how recent the
 * newest piece is — the two facts that make a pile of rows feel like a
 * memory. It still reads "nothing yet" when there is nothing yet.
 */
export const ChatEmptyState = ({ onSuggestion }: ChatEmptyStateProps) => {
  const [stats, setStats] = useState<MemoryStats | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/summary/stats")
      if (!res.ok) return
      const data = await res.json()
      if (typeof data.total === "number") {
        setStats({
          total: data.total,
          bySource: data.bySource ?? {},
          newest: typeof data.newest === "string" ? data.newest : null
        })
      }
    } catch {
      // A missing count is not worth showing an error for; the screen simply
      // renders without it.
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const hasMemory = (stats?.total ?? 0) > 0
  const chips = stats ? memoryConstellation(stats) : []
  const newest = stats ? describeNewest(stats.newest) : null

  // Phrased to match what the retrieval layers actually respond to: a topical
  // question for relevance search, and the explicit wording that triggers
  // full-transcript recovery.
  const suggestions = hasMemory
    ? [
        "What have we talked about recently?",
        "What do you know about me so far?",
        "Recover the full conversation about "
      ]
    : []

  return (
    <div className="flex flex-col items-center gap-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
      <Brand />

      {stats !== null && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-muted-foreground">
            {hasMemory ? (
              <>
                <span className="font-medium tabular-nums text-foreground">
                  {stats.total.toLocaleString()}
                </span>{" "}
                {stats.total === 1 ? "memory entry" : "memory entries"}
                {newest && (
                  <>
                    {" "}
                    · newest{" "}
                    <span className="font-medium text-foreground">
                      {newest}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>No memory yet — chat, or import from the panel on the left</>
            )}
          </p>

          {chips.length > 0 && (
            <ul
              aria-label="Memory by source"
              className="flex max-w-md flex-wrap justify-center gap-1.5"
            >
              {chips.map((chip, index) => (
                <li
                  key={chip.key}
                  className="duration-300 animate-in fade-in zoom-in-95 fill-mode-backwards"
                  style={{ animationDelay: `${150 + index * 80}ms` }}
                >
                  <MemorySourceChip
                    source={chip.key}
                    title={`${Math.round(chip.share * 100)}% of your memory`}
                  >
                    {chip.label}{" "}
                    <span className="tabular-nums opacity-70">
                      {chip.count.toLocaleString()}
                    </span>
                  </MemorySourceChip>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex max-w-md flex-wrap justify-center gap-2">
          {suggestions.map(text => (
            <button
              key={text}
              type="button"
              onClick={() => onSuggestion(text)}
              className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {text.trim()}
              {text.endsWith(" ") && "…"}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
