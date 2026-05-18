"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { IconHistory, IconBrandOpenai } from "@tabler/icons-react"
import { useCallback, useRef, useState } from "react"

interface SummaryRow {
  id: string
  content: string
  created_at: string
}

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

interface ImportResult {
  conversations_found: number
  chunks_processed: number
  inserted: number
}

export function MemoryHistorySheet() {
  const [open, setOpen] = useState(false)
  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoredId, setRestoredId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Import state (shared between ChatGPT and Claude importers)
  const chatgptFileInputRef = useRef<HTMLInputElement>(null)
  const claudeFileInputRef = useRef<HTMLInputElement>(null)
  const [importingSource, setImportingSource] = useState<
    "chatgpt" | "claude" | null
  >(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/summary/history")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummaries(data.summaries ?? [])
    } catch (e) {
      setError("Failed to load history")
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setRestoredId(null)
      setError(null)
      setImportResult(null)
      setImportError(null)
      setImportingSource(null)
      loadHistory()
    }
  }

  const handleImport = async (
    e: React.ChangeEvent<HTMLInputElement>,
    source: "chatgpt" | "claude"
  ) => {
    const file = e.target.files?.[0]
    // Reset input so re-selecting the same file triggers onChange again
    e.target.value = ""
    if (!file) return

    setImportingSource(source)
    setImportResult(null)
    setImportError(null)

    try {
      const fd = new FormData()
      fd.append("file", file)

      const endpoint =
        source === "chatgpt" ? "/api/import/chatgpt" : "/api/import/claude"
      const res = await fetch(endpoint, { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok || !data.success) {
        setImportError(
          data.reason ?? data.message ?? `Server error (${res.status})`
        )
        return
      }

      setImportResult({
        conversations_found: data.conversations_found ?? 0,
        chunks_processed: data.chunks_processed ?? 0,
        inserted: data.inserted ?? 0
      })

      // Refresh history list to show newly inserted summaries
      await loadHistory()
    } catch {
      setImportError("Network error — check your connection and try again")
    } finally {
      setImportingSource(null)
    }
  }

  const handleRestore = async (id: string) => {
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
      await loadHistory()
    } catch {
      setError("Failed to restore version")
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          className="size-[36px] p-1"
          variant="ghost"
          title="Memory history"
        >
          <IconHistory size={24} />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="flex w-[380px] flex-col gap-4 p-4">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <IconHistory size={18} />
            Memory History
          </SheetTitle>
        </SheetHeader>

        {restoredId && (
          <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            Version restored — now active as latest memory.
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
            No memory snapshots yet.
            <br />
            Send a few messages to generate one.
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <ul className="flex flex-col gap-2 pr-2">
              {summaries.map((row, idx) => {
                const isCurrent = idx === 0
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
                        <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                          Current
                        </span>
                      )}
                    </div>

                    <p className="mb-2 leading-snug text-foreground/80">
                      {preview(row.content)}
                    </p>

                    {!isCurrent && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={isRestoring || restoringId !== null}
                        onClick={() => handleRestore(row.id)}
                      >
                        {isRestoring
                          ? "Restoring…"
                          : justRestored
                            ? "Restored ✓"
                            : "Restore"}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}

        {/* Import section */}
        <div className="mt-auto border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Import conversation history
          </p>

          {/* Hidden file inputs */}
          <input
            ref={chatgptFileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => handleImport(e, "chatgpt")}
          />
          <input
            ref={claudeFileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => handleImport(e, "claude")}
          />

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              disabled={importingSource !== null}
              onClick={() => chatgptFileInputRef.current?.click()}
            >
              <IconBrandOpenai size={13} className="mr-1 shrink-0" />
              {importingSource === "chatgpt" ? "Importing…" : "ChatGPT"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              disabled={importingSource !== null}
              onClick={() => claudeFileInputRef.current?.click()}
            >
              <span className="mr-1 shrink-0 text-[11px] font-bold">A</span>
              {importingSource === "claude" ? "Importing…" : "Claude"}
            </Button>
          </div>

          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Upload{" "}
            <code className="rounded bg-muted px-0.5">conversations.json</code>{" "}
            from your ChatGPT or Claude export.
          </p>

          {importResult && (
            <div className="mt-2 rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              ✓ Imported {importResult.inserted} memory
              {importResult.inserted !== 1 ? " entries" : " entry"} from{" "}
              {importResult.conversations_found} conversation
              {importResult.conversations_found !== 1 ? "s" : ""}
              {importResult.inserted === 0 ? " — nothing new to save" : ""}
            </div>
          )}

          {importError && (
            <div className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {importError}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
