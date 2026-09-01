"use client"

import type { TimelineEntry } from "@/lib/timeline-parser"
import { useCallback, useState } from "react"

/**
 * Loading and paging the timeline.
 *
 * Split out of the sheet so the two panes can be given what they show rather
 * than reaching into five pieces of its state.
 */
export function useTimelineEntries() {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/timeline")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data.entries ?? [])
      setNextOffset(data.nextOffset ?? null)
    } catch {
      setError("Failed to load timeline")
    } finally {
      setLoading(false)
    }
  }, [])

  // Filters and counts apply to what has been loaded. With more pages
  // outstanding the list footer says so, so a search that finds nothing is not
  // mistaken for an empty history.
  const loadMore = useCallback(async () => {
    if (nextOffset === null) return

    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch(`/api/timeline?offset=${nextOffset}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(previous => [...previous, ...(data.entries ?? [])])
      setNextOffset(data.nextOffset ?? null)
    } catch {
      setError("Failed to load more entries")
    } finally {
      setLoadingMore(false)
    }
  }, [nextOffset])

  return {
    entries,
    nextOffset,
    loading,
    loadingMore,
    error,
    load,
    loadMore
  }
}
