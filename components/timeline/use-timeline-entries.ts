"use client"

import type { TimelineEntry } from "@/lib/timeline-parser"
import { useCallback, useState } from "react"

/**
 * Loading and paging the timeline.
 *
 * Split out of the sheet so the two panes can be given what they show rather
 * than reaching into five pieces of its state.
 */
/** Older entries after the ones in hand, without repeating any: a row that
 *  straddles a page boundary must not appear twice. */
function append(previous: TimelineEntry[], more: TimelineEntry[]) {
  const seen = new Set(previous.map(entry => entry.id))
  return [...previous, ...more.filter(entry => !seen.has(entry.id))]
}

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
      setEntries(previous => append(previous, data.entries ?? []))
      setNextOffset(data.nextOffset ?? null)
    } catch {
      setError("Failed to load more entries")
    } finally {
      setLoadingMore(false)
    }
  }, [nextOffset])

  /**
   * Load pages until an entry older than `date` (YYYY-MM-DD) is present, or
   * there are none left. Pages are contiguous slices of the display order,
   * newest first, so once an older entry is in hand everything from `date`
   * onward is too.
   *
   * For the chart: a month it shows may lie past what the list has loaded,
   * and filtering only what is loaded made a month of 182 entries read as
   * "0 conversations".
   */
  const loadUntil = useCallback(
    async (date: string, from: TimelineEntry[], offset: number | null) => {
      let all = from
      let next = offset
      if (all.some(entry => entry.date < date)) return
      setLoadingMore(true)
      setError(null)
      try {
        while (next !== null && !all.some(entry => entry.date < date)) {
          const res = await fetch(`/api/timeline?offset=${next}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          all = append(all, data.entries ?? [])
          next = data.nextOffset ?? null
          setEntries(all)
          setNextOffset(next)
        }
      } catch {
        setError("Failed to load more entries")
      } finally {
        setLoadingMore(false)
      }
    },
    []
  )

  return {
    entries,
    nextOffset,
    loading,
    loadingMore,
    error,
    load,
    loadMore,
    loadUntil
  }
}
