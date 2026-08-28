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
import { clearSourceMessage } from "@/lib/memory-backup-state"
import { ImportSource } from "@/lib/memory-import-state"
import { FC, useState } from "react"

const SOURCES: { source: ImportSource; label: string }[] = [
  { source: "chatgpt", label: "ChatGPT" },
  { source: "claude", label: "Claude" },
  { source: "perplexity", label: "Perplexity" }
]

interface MemorySourceClearProps {
  /** True while an import is running — clearing under one would race it. */
  disabled: boolean
  onCleared: () => void | Promise<void>
  onError: (message: string) => void
}

/** Delete everything imported from one provider. */
export const MemorySourceClear: FC<MemorySourceClearProps> = ({
  disabled,
  onCleared,
  onError
}) => {
  const [clearing, setClearing] = useState<ImportSource | null>(null)
  const [confirming, setConfirming] = useState<ImportSource | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const handleClear = async (source: ImportSource) => {
    setConfirming(null)
    setClearing(source)
    setResult(null)

    try {
      const res = await fetch("/api/import/clear-source", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.reason ?? data.message)

      setResult(clearSourceMessage(source, data.deleted ?? 0))
      await onCleared()
    } catch {
      onError(`Failed to clear ${source} data`)
    } finally {
      setClearing(null)
    }
  }

  const confirmingLabel = SOURCES.find(
    entry => entry.source === confirming
  )?.label

  return (
    <div className="mt-3 border-t pt-2">
      {/* Deleting every ChatGPT import is as irreversible as clearing
          everything, and it had the weaker affordance: a two-click toggle that
          disarmed itself on blur, so the second click could land on a button
          that had quietly gone back to being the first. */}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={open => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete everything imported from {confirmingLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes every memory entry that came from your{" "}
              {confirmingLabel} export. Conversations from other sources, and
              anything written in this app, are left alone. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirming && handleClear(confirming)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {confirmingLabel} data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
        Clear imported data by source
      </p>

      <div className="flex gap-1.5">
        {SOURCES.map(({ source, label }) => (
          <Button
            key={source}
            size="sm"
            variant="ghost"
            className="h-6 flex-1 text-[10px] text-muted-foreground hover:text-destructive"
            disabled={disabled || clearing !== null}
            onClick={() => setConfirming(source)}
          >
            {clearing === source ? "…" : `✕ ${label}`}
          </Button>
        ))}
      </div>

      {result && <p className="mt-1 text-[10px] text-success">{result}</p>}
    </div>
  )
}
