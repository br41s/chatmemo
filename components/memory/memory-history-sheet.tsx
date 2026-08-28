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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { IconHistory, IconTrash } from "@tabler/icons-react"
import { useState } from "react"
import { MemoryBackupSection } from "./memory-backup-section"
import { MemoryHistoryList } from "./memory-history-list"
import { MemoryImportSection } from "./memory-import-section"
import { useMemoryHistory } from "./use-memory-history"

/**
 * The memory panel.
 *
 * This was 886 lines and twenty-three `useState` hooks covering four unrelated
 * jobs — listing memory, importing an export, clearing one provider's rows, and
 * backing the whole thing up. What is left here is the shell: the sheet, the
 * header, and the one thing all four sections share, which is that any of them
 * changing memory means the list has to be re-read.
 */
export function MemoryHistorySheet() {
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const history = useMemoryHistory()

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // Opening is the reset point: last run's messages are stale by now.
      history.reset()
      setConfirmClear(false)
      history.load()
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

      <SheetContent
        side="left"
        className="flex w-full flex-col gap-4 p-4 sm:w-[380px]"
      >
        {/* Clearing every summary is irreversible and there is no undo, so it
            asks properly. It used to be a two-click inline toggle that disarmed
            itself on blur — the same affordance as a nit-level action, for
            deleting the person's entire memory. */}
        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all memory?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes every stored summary — {history.summaries.length}{" "}
                loaded here, and any older ones not yet shown — including
                everything imported from ChatGPT, Claude and Perplexity. It
                cannot be undone.
                {"\n\n"}
                Export a backup first if you might want this back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep my memory</AlertDialogCancel>
              <AlertDialogAction
                onClick={history.clearAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <SheetHeader className="pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <IconHistory size={18} />
              Memory History
            </SheetTitle>
            {history.summaries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                disabled={history.clearingAll}
                onClick={() => setConfirmClear(true)}
              >
                <IconTrash size={13} className="mr-1" />
                {history.clearingAll ? "Clearing…" : "Clear all"}
              </Button>
            )}
          </div>
        </SheetHeader>

        {history.restoredId && (
          <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            Version restored — now active as latest memory.
          </div>
        )}

        {history.error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {history.error}
          </div>
        )}

        <MemoryHistoryList
          summaries={history.summaries}
          nextOffset={history.nextOffset}
          loading={history.loading}
          loadingMore={history.loadingMore}
          restoringId={history.restoringId}
          restoredId={history.restoredId}
          deletingId={history.deletingId}
          onLoadMore={history.loadMore}
          onRestore={history.restore}
          onDelete={history.remove}
        />

        {/* One block, pushed to the bottom: everything here writes to memory
            rather than reading it, and the list above takes the space. */}
        <div className="mt-auto">
          <MemoryImportSection
            onImported={history.load}
            onError={history.setError}
          />

          <MemoryBackupSection onRestored={history.load} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
