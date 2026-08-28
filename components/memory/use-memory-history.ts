"use client"

import { useCallback, useState } from "react"

export interface SummaryRow {
  id: string
  content: string
  created_at: string
}

/**
 * The memory list: loading it, paging it, and the two things you can do to a
 * row.
 *
 * Pulled out of the sheet so the import, per-source clear and backup sections
 * can ask for a refresh without reaching into eleven pieces of the sheet's
 * state. They take a single `onMemoryChanged` callback instead.
 */
export function useMemoryHistory() {
  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoredId, setRestoredId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/summary/history")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummaries(data.summaries ?? [])
      setNextOffset(data.nextOffset ?? null)
    } catch {
      setError("Failed to load history")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (nextOffset === null) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch(`/api/summary/history?offset=${nextOffset}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummaries(prev => [...prev, ...(data.summaries ?? [])])
      setNextOffset(data.nextOffset ?? null)
    } catch {
      setError("Failed to load more entries")
    } finally {
      setLoadingMore(false)
    }
  }, [nextOffset])

  const restore = useCallback(
    async (id: string) => {
      setRestoringId(id)
      setRestoredId(null)
      setError(null)
      try {
        const res = await fetch("/api/summary/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setRestoredId(id)
        await load()
      } catch {
        setError("Failed to restore version")
      } finally {
        setRestoringId(null)
      }
    },
    [load]
  )

  const remove = useCallback(async (id: string) => {
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch("/api/summary/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSummaries(prev => prev.filter(row => row.id !== id))
    } catch {
      setError("Failed to delete entry")
    } finally {
      setDeletingId(null)
    }
  }, [])

  const clearAll = useCallback(async () => {
    setClearingAll(true)
    setError(null)
    try {
      const res = await fetch("/api/summary/clear", { method: "DELETE" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSummaries([])
    } catch {
      setError("Failed to clear memory")
    } finally {
      setClearingAll(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRestoredId(null)
    setError(null)
  }, [])

  return {
    summaries,
    nextOffset,
    loading,
    loadingMore,
    restoringId,
    restoredId,
    deletingId,
    clearingAll,
    error,
    setError,
    load,
    loadMore,
    restore,
    remove,
    clearAll,
    reset
  }
}
