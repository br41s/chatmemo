"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RowListSkeleton } from "@/components/ui/skeletons"
import { IconTrash } from "@tabler/icons-react"
import { FC, useState } from "react"
import { SummaryRow } from "./use-memory-history"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function preview(content: string, maxChars = 120): string {
  const clean = content.replace(/\s+/g, " ").trim()
  return clean.length > maxChars ? clean.slice(0, maxChars) + "…" : clean
}

interface MemoryHistoryListProps {
  summaries: SummaryRow[]
  nextOffset: number | null
  loading: boolean
  loadingMore: boolean
  restoringId: string | null
  restoredId: string | null
  deletingId: string | null
  onLoadMore: () => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

/** The list of stored memory, its search box, and the two row actions. */
export const MemoryHistoryList: FC<MemoryHistoryListProps> = ({
  summaries,
  nextOffset,
  loading,
  loadingMore,
  restoringId,
  restoredId,
  deletingId,
  onLoadMore,
  onRestore,
  onDelete
}) => {
  const [search, setSearch] = useState("")

  // The panel that manages memory had no way to find anything in it — the
  // timeline next door has filters, this listed every row newest-first with a
  // 120-character preview. Filtering is over what has been loaded, which the
  // empty state says, so no result is not mistaken for no history.
  const query = search.trim().toLowerCase()
  const visible = query
    ? summaries.filter(row => row.content.toLowerCase().includes(query))
    : summaries

  if (loading) {
    return <RowListSkeleton label="Loading memory history" />
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
        No memory snapshots yet.
        <br />
        Send a few messages to generate one.
      </div>
    )
  }

  return (
    <>
      <Input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${summaries.length} loaded ${
          summaries.length === 1 ? "entry" : "entries"
        }…`}
        className="h-8 text-xs"
        aria-label="Search memory entries"
      />

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
          <p>No loaded entry matches “{search.trim()}”.</p>
          {nextOffset !== null && (
            <p className="text-xs">
              Older entries have not been loaded yet — load more below and
              search again.
            </p>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="flex flex-col gap-2 pr-2">
            {visible.map(row => {
              // Newest overall, not newest in the filtered view.
              const isCurrent = row.id === summaries[0]?.id
              const isRestoring = restoringId === row.id
              const justRestored = restoredId === row.id

              return (
                <li
                  key={row.id}
                  className={`rounded-lg border p-3 text-sm transition-colors ${
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-background"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(row.created_at)}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                        Current
                      </span>
                    )}
                  </div>

                  <p className="mb-2 leading-snug text-foreground/80">
                    {preview(row.content)}
                  </p>

                  <div className="flex items-center gap-1.5">
                    {!isCurrent && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={
                          isRestoring ||
                          restoringId !== null ||
                          deletingId !== null
                        }
                        onClick={() => onRestore(row.id)}
                      >
                        {isRestoring
                          ? "Restoring…"
                          : justRestored
                            ? "Restored ✓"
                            : "Restore"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={deletingId === row.id || restoringId !== null}
                      onClick={() => onDelete(row.id)}
                      title="Delete this entry"
                    >
                      {deletingId === row.id ? (
                        <span className="text-xs">…</span>
                      ) : (
                        <IconTrash size={13} />
                      )}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>

          {nextOffset !== null && (
            <div className="flex justify-center py-3 pr-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </ScrollArea>
      )}
    </>
  )
}
