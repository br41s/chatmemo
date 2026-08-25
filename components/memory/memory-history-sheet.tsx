"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RowListSkeleton } from "@/components/ui/skeletons"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import {
  IconHistory,
  IconBrandOpenai,
  IconTrash,
  IconDatabaseExport,
  IconDatabaseImport
} from "@tabler/icons-react"
import {
  importTooLargeMessage,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_MB
} from "@/lib/import-limits"
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
  skipped: number
  inserted: number
}

export function MemoryHistorySheet() {
  const [open, setOpen] = useState(false)
  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [search, setSearch] = useState("")
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoredId, setRestoredId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Import state (shared between all importers)
  const chatgptFileInputRef = useRef<HTMLInputElement>(null)
  const claudeFileInputRef = useRef<HTMLInputElement>(null)
  const perplexityFileInputRef = useRef<HTMLInputElement>(null)
  const [importingSource, setImportingSource] = useState<
    "chatgpt" | "claude" | "perplexity" | null
  >(null)
  const [importProgress, setImportProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Per-source clear state
  const [clearingSource, setClearingSource] = useState<
    "chatgpt" | "claude" | "perplexity" | null
  >(null)
  const [confirmClearSource, setConfirmClearSource] = useState<
    "chatgpt" | "claude" | "perplexity" | null
  >(null)
  const [clearSourceResult, setClearSourceResult] = useState<string | null>(
    null
  )

  // Backup / restore state
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const [exportingBackup, setExportingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupResult, setBackupResult] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/summary/history")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummaries(data.summaries ?? [])
      setNextOffset(data.nextOffset ?? null)
    } catch (e) {
      setError("Failed to load history")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMoreHistory = useCallback(async () => {
    if (nextOffset === null) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch(`/api/summary/history?offset=${nextOffset}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummaries(prev => [...prev, ...(data.summaries ?? [])])
      setNextOffset(data.nextOffset ?? null)
    } catch (e) {
      setError("Failed to load more entries")
    } finally {
      setLoadingMore(false)
    }
  }, [nextOffset])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setRestoredId(null)
      setError(null)
      setImportResult(null)
      setImportError(null)
      setImportingSource(null)
      setImportProgress(null)
      setConfirmClear(false)
      setConfirmClearSource(null)
      setClearSourceResult(null)
      setBackupError(null)
      setBackupResult(null)
      loadHistory()
    }
  }

  const handleClearSource = async (
    source: "chatgpt" | "claude" | "perplexity"
  ) => {
    if (confirmClearSource !== source) {
      setConfirmClearSource(source)
      setClearSourceResult(null)
      return
    }
    setClearingSource(source)
    setConfirmClearSource(null)
    setError(null)
    try {
      const res = await fetch("/api/import/clear-source", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.reason ?? data.message)
      const label = source.charAt(0).toUpperCase() + source.slice(1)
      setClearSourceResult(
        `${label} data cleared (${data.deleted ?? 0} rows removed)`
      )
      await loadHistory()
    } catch (e) {
      setError(`Failed to clear ${source} data`)
    } finally {
      setClearingSource(null)
    }
  }

  const handleImport = async (
    e: React.ChangeEvent<HTMLInputElement>,
    source: "chatgpt" | "claude" | "perplexity"
  ) => {
    const files = Array.from(e.target.files ?? [])
    // Reset input so re-selecting the same files triggers onChange again
    e.target.value = ""
    if (files.length === 0) return

    setImportingSource(source)
    setImportResult(null)
    setImportError(null)
    setImportProgress(
      files.length > 1 ? { current: 1, total: files.length } : null
    )

    const accumulated: ImportResult = {
      conversations_found: 0,
      chunks_processed: 0,
      skipped: 0,
      inserted: 0
    }

    const endpoint =
      source === "chatgpt"
        ? "/api/import/chatgpt"
        : source === "perplexity"
          ? "/api/import/perplexity"
          : "/api/import/claude"

    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) {
          setImportProgress({ current: i + 1, total: files.length })
        }

        // Checked here so the message can explain what to do. Sent unchecked,
        // an oversized export is rejected by the platform before the route
        // runs and comes back as a bare status code.
        if (files[i].size > MAX_IMPORT_FILE_BYTES) {
          setImportError(importTooLargeMessage(files[i].name, files[i].size))
          return
        }

        const fd = new FormData()
        fd.append("file", files[i])

        let res: Response
        let data: Record<string, unknown>
        try {
          res = await fetch(endpoint, { method: "POST", body: fd })
          data = await res.json()
        } catch {
          setImportError(
            `File ${i + 1}/${files.length} (${files[i].name}): Network error`
          )
          return
        }

        if (!res.ok || !data.success) {
          setImportError(
            `File ${i + 1}/${files.length} (${files[i].name}): ${
              (data.reason as string) ??
              (data.message as string) ??
              `Server error (${res.status})`
            }`
          )
          return
        }

        accumulated.conversations_found +=
          (data.conversations_found as number) ?? 0
        accumulated.chunks_processed += (data.chunks_processed as number) ?? 0
        accumulated.skipped += (data.skipped as number) ?? 0
        accumulated.inserted += (data.inserted as number) ?? 0
      }

      setImportResult(accumulated)
      // Refresh history list to show newly inserted summaries
      await loadHistory()
    } finally {
      setImportingSource(null)
      setImportProgress(null)
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

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch("/api/summary/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSummaries(prev => prev.filter(s => s.id !== id))
    } catch {
      setError("Failed to delete entry")
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Backup helpers
  // ---------------------------------------------------------------------------

  function triggerDownload(content: string, filename: string) {
    const blob = new Blob([content], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportBackup = async () => {
    setExportingBackup(true)
    setBackupError(null)
    setBackupResult(null)
    try {
      // The route pages so no single response carries the whole table. Follow
      // nextOffset to the end and merge, so the backup is still complete.
      type ExportPage = {
        version: number
        exportedAt: string
        sources: Record<string, { content: string; created_at: string }[]>
        nextOffset: number | null
      }

      const sources: Record<string, { content: string; created_at: string }[]> =
        {}
      let exportedAt = ""
      let offset: number | null = 0

      while (offset !== null) {
        const res: Response = await fetch(
          `/api/export/summaries?offset=${offset}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const pageData: ExportPage = await res.json()

        // Stamp the backup with the time the export started, not each page.
        if (!exportedAt) exportedAt = pageData.exportedAt

        for (const [key, rows] of Object.entries(pageData.sources ?? {})) {
          if (rows.length === 0) continue
          ;(sources[key] ??= []).push(...rows)
        }

        offset = pageData.nextOffset
      }

      const dateStr = exportedAt.slice(0, 10)
      const sourceLabels: Record<string, string> = {
        claude: "claude",
        chatgpt: "chatgpt",
        perplexity: "perplexity",
        other: "other"
      }

      let filesDownloaded = 0
      for (const [key, rows] of Object.entries(sources)) {
        if (rows.length === 0) continue
        const filename = `chatmemo-backup-${sourceLabels[key] ?? key}-${dateStr}.json`
        const payload = JSON.stringify(
          { version: 1, source: key, exportedAt, rows },
          null,
          2
        )
        // Stagger downloads slightly so browsers don't block them
        await new Promise(resolve => setTimeout(resolve, filesDownloaded * 150))
        triggerDownload(payload, filename)
        filesDownloaded++
      }

      const totalRows = Object.values(sources).reduce(
        (sum, rows) => sum + rows.length,
        0
      )
      setBackupResult(
        `Downloaded ${filesDownloaded} file${filesDownloaded !== 1 ? "s" : ""} — ${totalRows} rows total`
      )
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Export failed")
    } finally {
      setExportingBackup(false)
    }
  }

  const handleRestoreBackup = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setRestoringBackup(true)
    setBackupError(null)
    setBackupResult(null)

    try {
      const text = await file.text()
      let parsed: { rows?: unknown; version?: number; source?: string }
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error("File is not valid JSON")
      }

      if (!Array.isArray(parsed.rows)) {
        throw new Error('Backup file must have a "rows" array')
      }

      const res = await fetch("/api/import/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.rows })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? `Server error ${res.status}`)
      }

      setBackupResult(
        `Restored ${data.inserted} row${data.inserted !== 1 ? "s" : ""}${
          data.skipped > 0 ? ` (${data.skipped} already existed, skipped)` : ""
        }`
      )
      await loadHistory()
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Restore failed")
    } finally {
      setRestoringBackup(false)
    }
  }

  const handleClearAll = async () => {
    setClearingAll(true)
    setConfirmClear(false)
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
  }

  // The panel that manages memory had no way to find anything in it — the
  // timeline next door has filters, this listed every row newest-first with a
  // 120-character preview. Filtering is over what has been loaded, which the
  // footer says, so an empty result is not mistaken for an empty history.
  const query = search.trim().toLowerCase()
  const visibleSummaries = query
    ? summaries.filter(row => row.content.toLowerCase().includes(query))
    : summaries

  // Clearing every summary is irreversible and there is no undo, so it asks
  // properly. It used to be a two-click inline toggle that disarmed itself on
  // blur — the same affordance as a nit-level action, for deleting the user's
  // entire memory.
  const clearAllDialog = (
    <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all memory?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every stored summary — {summaries.length} loaded here,
            and any older ones not yet shown — including everything imported
            from ChatGPT, Claude and Perplexity. It cannot be undone.
            {"\n\n"}
            Export a backup first if you might want this back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my memory</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleClearAll}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

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
        {clearAllDialog}

        <SheetHeader className="pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <IconHistory size={18} />
              Memory History
            </SheetTitle>
            {summaries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                disabled={clearingAll}
                onClick={() => setConfirmClear(true)}
              >
                <IconTrash size={13} className="mr-1" />
                {clearingAll ? "Clearing…" : "Clear all"}
              </Button>
            )}
          </div>
        </SheetHeader>

        {restoredId && (
          <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            Version restored — now active as latest memory.
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {summaries.length > 0 && (
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${summaries.length} loaded ${
              summaries.length === 1 ? "entry" : "entries"
            }…`}
            className="h-8 text-xs"
            aria-label="Search memory entries"
          />
        )}

        {loading ? (
          <RowListSkeleton label="Loading memory history" />
        ) : summaries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
            No memory snapshots yet.
            <br />
            Send a few messages to generate one.
          </div>
        ) : visibleSummaries.length === 0 ? (
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
              {visibleSummaries.map((row, idx) => {
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
                          onClick={() => handleRestore(row.id)}
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
                        onClick={() => handleDelete(row.id)}
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
                  onClick={loadMoreHistory}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
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
            multiple
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
          <input
            ref={perplexityFileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={e => handleImport(e, "perplexity")}
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
              {importingSource === "chatgpt"
                ? importProgress
                  ? `Importing ${importProgress.current}/${importProgress.total}…`
                  : "Importing…"
                : "ChatGPT"}
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

            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              disabled={importingSource !== null}
              onClick={() => perplexityFileInputRef.current?.click()}
            >
              <span className="mr-1 shrink-0 text-[11px] font-bold">P</span>
              {importingSource === "perplexity" ? "Importing…" : "Perplexity"}
            </Button>
          </div>

          <p className="mt-1.5 text-[10px] text-muted-foreground">
            ChatGPT &amp; Perplexity: select multiple{" "}
            <code className="rounded bg-muted px-0.5">.json</code> files at
            once. Subsequent imports automatically skip already-imported
            conversations.
          </p>

          {importResult && (
            <div className="mt-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              ✓ Imported {importResult.inserted} memory
              {importResult.inserted !== 1 ? " entries" : " entry"} from{" "}
              {importResult.conversations_found} conversation
              {importResult.conversations_found !== 1 ? "s" : ""}
              {importResult.skipped > 0
                ? ` (${importResult.skipped} already imported, skipped)`
                : ""}
              {importResult.inserted === 0 && !importResult.skipped
                ? " — nothing new to save"
                : ""}
            </div>
          )}

          {importError && (
            <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {importError}
            </div>
          )}

          {/* Per-source selective clear */}
          <div className="mt-3 border-t pt-2">
            <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
              Clear imported data by source
            </p>
            <div className="flex gap-1.5">
              {(
                [
                  { source: "chatgpt", label: "ChatGPT" },
                  { source: "claude", label: "Claude" },
                  { source: "perplexity", label: "Perplexity" }
                ] as const
              ).map(({ source, label }) => {
                const isClearing = clearingSource === source
                const isConfirming = confirmClearSource === source
                return (
                  <Button
                    key={source}
                    size="sm"
                    variant="ghost"
                    className={`h-6 flex-1 text-[10px] ${
                      isConfirming
                        ? "text-destructive hover:text-destructive/80"
                        : "text-muted-foreground hover:text-destructive"
                    }`}
                    disabled={
                      clearingSource !== null || importingSource !== null
                    }
                    onClick={() => handleClearSource(source)}
                    onBlur={() => {
                      if (confirmClearSource === source)
                        setConfirmClearSource(null)
                    }}
                  >
                    {isClearing ? "…" : isConfirming ? `Confirm` : `✕ ${label}`}
                  </Button>
                )
              })}
            </div>
            {clearSourceResult && (
              <p className="mt-1 text-[10px] text-success">
                {clearSourceResult}
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              Click once to confirm, again to execute.
            </p>
          </div>

          {/* Backup & Restore */}
          <div className="mt-3 border-t pt-2">
            <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
              Backup &amp; Restore
            </p>

            {/* Hidden restore file input */}
            <input
              ref={restoreFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleRestoreBackup}
            />

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={exportingBackup || restoringBackup}
                onClick={handleExportBackup}
              >
                <IconDatabaseExport size={13} className="mr-1 shrink-0" />
                {exportingBackup ? "Exporting…" : "Export all"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={restoringBackup || exportingBackup}
                onClick={() => restoreFileInputRef.current?.click()}
              >
                <IconDatabaseImport size={13} className="mr-1 shrink-0" />
                {restoringBackup ? "Restoring…" : "Restore backup"}
              </Button>
            </div>

            <p className="mt-1 text-[10px] text-muted-foreground">
              Export downloads one{" "}
              <code className="rounded bg-muted px-0.5">.json</code> file per
              source. Restore accepts any of those files — duplicates are
              skipped automatically.
            </p>

            {backupResult && (
              <p className="mt-1.5 text-[10px] text-success">
                ✓ {backupResult}
              </p>
            )}
            {backupError && (
              <p className="mt-1.5 text-[10px] text-destructive">
                {backupError}
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
