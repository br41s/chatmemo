"use client"

import { Button } from "@/components/ui/button"
import {
  backupFileName,
  backupReducer,
  exportSummaryMessage,
  initialBackupState,
  restoreSummaryMessage
} from "@/lib/memory-backup-state"
import { IconDatabaseExport, IconDatabaseImport } from "@tabler/icons-react"
import { FC, useReducer, useRef } from "react"

type ExportPage = {
  version: number
  exportedAt: string
  sources: Record<string, { content: string; created_at: string }[]>
  nextOffset: number | null
}

/** Hand the browser a file to save. */
function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

interface MemoryBackupSectionProps {
  onRestored: () => void | Promise<void>
}

/** Taking every memory row out, and putting one back. */
export const MemoryBackupSection: FC<MemoryBackupSectionProps> = ({
  onRestored
}) => {
  const [state, dispatch] = useReducer(backupReducer, initialBackupState)
  const restoreInput = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    dispatch({ type: "export-started" })

    try {
      // The route pages, so no single response carries the whole table. Follow
      // nextOffset to the end and merge, so the backup is still complete.
      const sources: Record<string, { content: string; created_at: string }[]> =
        {}
      let exportedAt = ""
      let offset: number | null = 0

      while (offset !== null) {
        const res: Response = await fetch(
          `/api/export/summaries?offset=${offset}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const page: ExportPage = await res.json()

        // Stamp the backup with the time the export started, not each page.
        if (!exportedAt) exportedAt = page.exportedAt

        for (const [key, rows] of Object.entries(page.sources ?? {})) {
          if (rows.length === 0) continue
          ;(sources[key] ??= []).push(...rows)
        }

        offset = page.nextOffset
      }

      let filesDownloaded = 0
      for (const [key, rows] of Object.entries(sources)) {
        if (rows.length === 0) continue

        const payload = JSON.stringify(
          { version: 1, source: key, exportedAt, rows },
          null,
          2
        )
        // Stagger downloads slightly so browsers don't block them.
        await new Promise(resolve => setTimeout(resolve, filesDownloaded * 150))
        triggerDownload(payload, backupFileName(key, exportedAt))
        filesDownloaded++
      }

      const totalRows = Object.values(sources).reduce(
        (sum, rows) => sum + rows.length,
        0
      )

      dispatch({
        type: "succeeded",
        message: exportSummaryMessage(filesDownloaded, totalRows)
      })
    } catch (error) {
      dispatch({
        type: "failed",
        message: error instanceof Error ? error.message : "Export failed"
      })
    } finally {
      dispatch({ type: "export-settled" })
    }
  }

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    dispatch({ type: "restore-started" })

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

      dispatch({
        type: "succeeded",
        message: restoreSummaryMessage(data.inserted, data.skipped)
      })
      await onRestored()
    } catch (error) {
      dispatch({
        type: "failed",
        message: error instanceof Error ? error.message : "Restore failed"
      })
    } finally {
      dispatch({ type: "restore-settled" })
    }
  }

  const busy = state.exporting || state.restoring

  return (
    <div className="mt-3 border-t pt-2">
      <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
        Backup &amp; Restore
      </p>

      <input
        ref={restoreInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleRestore}
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          disabled={busy}
          onClick={handleExport}
        >
          <IconDatabaseExport size={13} className="mr-1 shrink-0" />
          {state.exporting ? "Exporting…" : "Export all"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          disabled={busy}
          onClick={() => restoreInput.current?.click()}
        >
          <IconDatabaseImport size={13} className="mr-1 shrink-0" />
          {state.restoring ? "Restoring…" : "Restore backup"}
        </Button>
      </div>

      <p className="mt-1 text-[10px] text-muted-foreground">
        Export downloads one{" "}
        <code className="rounded bg-muted px-0.5">.json</code> file per source.
        Restore accepts any of those files — duplicates are skipped
        automatically.
      </p>

      {state.result && (
        <p className="mt-1.5 text-[10px] text-success">✓ {state.result}</p>
      )}
      {state.error && (
        <p className="mt-1.5 text-[10px] text-destructive">{state.error}</p>
      )}
    </div>
  )
}
