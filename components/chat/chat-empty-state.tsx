"use client"

import { Brand } from "@/components/ui/brand"
import { useCallback, useEffect, useState } from "react"
import { useTheme } from "next-themes"

interface ChatEmptyStateProps {
  /** Puts a suggestion into the composer. */
  onSuggestion: (text: string) => void
}

interface MemoryStats {
  total: number
}

/**
 * What a new chat opens on.
 *
 * It used to be a logo and an input. Nothing said the product had a memory, or
 * that asking about a past conversation would work, or that full transcripts
 * could be recovered — and full recovery only fires on a hardcoded phrase list,
 * so a person could only hit it by accident.
 *
 * The count is the honest version of the pitch: it says what is actually
 * stored, and reads "nothing yet" when there is nothing yet.
 */
export const ChatEmptyState = ({ onSuggestion }: ChatEmptyStateProps) => {
  const { theme } = useTheme()
  const [stats, setStats] = useState<MemoryStats | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/summary/stats")
      if (!res.ok) return
      const data = await res.json()
      if (typeof data.total === "number") setStats({ total: data.total })
    } catch {
      // A missing count is not worth showing an error for; the screen simply
      // renders without it.
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const hasMemory = (stats?.total ?? 0) > 0

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
    <div className="flex flex-col items-center gap-6">
      <Brand theme={theme === "dark" ? "dark" : "light"} />

      {stats !== null && (
        <p className="text-sm text-muted-foreground">
          {hasMemory ? (
            <>
              <span className="font-medium tabular-nums text-foreground">
                {stats.total.toLocaleString()}
              </span>{" "}
              {stats.total === 1 ? "memory entry" : "memory entries"} available
              to this chat
            </>
          ) : (
            <>No memory yet — chat, or import from the panel on the left</>
          )}
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="flex max-w-md flex-wrap justify-center gap-2">
          {suggestions.map(text => (
            <button
              key={text}
              type="button"
              onClick={() => onSuggestion(text)}
              className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
