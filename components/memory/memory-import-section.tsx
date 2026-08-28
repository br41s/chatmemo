"use client"

import { Button } from "@/components/ui/button"
import {
  importTooLargeMessage,
  MAX_IMPORT_FILE_BYTES
} from "@/lib/import-limits"
import {
  addImportTotals,
  emptyImportTotals,
  importReducer,
  importSummaryMessage,
  ImportSource,
  initialImportState
} from "@/lib/memory-import-state"
import { IconBrandOpenai } from "@tabler/icons-react"
import { FC, useReducer, useRef } from "react"
import { MemorySourceClear } from "./memory-source-clear"

const ENDPOINTS: Record<ImportSource, string> = {
  chatgpt: "/api/import/chatgpt",
  claude: "/api/import/claude",
  perplexity: "/api/import/perplexity"
}

interface MemoryImportSectionProps {
  onImported: () => void | Promise<void>
  onError: (message: string) => void
}

/** Bringing a ChatGPT, Claude or Perplexity export into memory. */
export const MemoryImportSection: FC<MemoryImportSectionProps> = ({
  onImported,
  onError
}) => {
  const [state, dispatch] = useReducer(importReducer, initialImportState)

  const chatgptInput = useRef<HTMLInputElement>(null)
  const claudeInput = useRef<HTMLInputElement>(null)
  const perplexityInput = useRef<HTMLInputElement>(null)

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
    source: ImportSource
  ) => {
    const files = Array.from(event.target.files ?? [])
    // Reset the input so re-selecting the same files fires onChange again.
    event.target.value = ""
    if (files.length === 0) return

    dispatch({ type: "started", source, fileCount: files.length })

    let totals = emptyImportTotals()

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]

        if (files.length > 1) {
          dispatch({ type: "file", current: index + 1, total: files.length })
        }

        // Checked here so the message can explain what to do. Sent unchecked,
        // an oversized export is rejected by the platform before the route
        // runs and comes back as a bare status code.
        if (file.size > MAX_IMPORT_FILE_BYTES) {
          dispatch({
            type: "failed",
            message: importTooLargeMessage(file.name, file.size)
          })
          return
        }

        const body = new FormData()
        body.append("file", file)

        const position = `File ${index + 1}/${files.length} (${file.name})`

        let res: Response
        let data: Record<string, unknown>
        try {
          res = await fetch(ENDPOINTS[source], { method: "POST", body })
          data = await res.json()
        } catch {
          dispatch({ type: "failed", message: `${position}: Network error` })
          return
        }

        if (!res.ok || !data.success) {
          const reason =
            (data.reason as string) ??
            (data.message as string) ??
            `Server error (${res.status})`
          dispatch({ type: "failed", message: `${position}: ${reason}` })
          return
        }

        totals = addImportTotals(totals, data)
      }

      dispatch({ type: "succeeded", totals })
      await onImported()
    } finally {
      dispatch({ type: "settled" })
    }
  }

  const importing = state.source !== null

  const label = (source: ImportSource, name: string) => {
    if (state.source !== source) return name
    if (state.progress) {
      return `Importing ${state.progress.current}/${state.progress.total}…`
    }
    return "Importing…"
  }

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Import conversation history
      </p>

      <input
        ref={chatgptInput}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        onChange={event => handleImport(event, "chatgpt")}
      />
      <input
        ref={claudeInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={event => handleImport(event, "claude")}
      />
      <input
        ref={perplexityInput}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        onChange={event => handleImport(event, "perplexity")}
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          disabled={importing}
          onClick={() => chatgptInput.current?.click()}
        >
          <IconBrandOpenai size={13} className="mr-1 shrink-0" />
          {label("chatgpt", "ChatGPT")}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          disabled={importing}
          onClick={() => claudeInput.current?.click()}
        >
          <span className="mr-1 shrink-0 text-[11px] font-bold">A</span>
          {label("claude", "Claude")}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          disabled={importing}
          onClick={() => perplexityInput.current?.click()}
        >
          <span className="mr-1 shrink-0 text-[11px] font-bold">P</span>
          {label("perplexity", "Perplexity")}
        </Button>
      </div>

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        ChatGPT &amp; Perplexity: select multiple{" "}
        <code className="rounded bg-muted px-0.5">.json</code> files at once.
        Subsequent imports automatically skip already-imported conversations.
      </p>

      {state.result && (
        <div className="mt-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
          ✓ {importSummaryMessage(state.result)}
        </div>
      )}

      {state.error && (
        <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </div>
      )}

      <MemorySourceClear
        disabled={importing}
        onCleared={onImported}
        onError={onError}
      />
    </div>
  )
}
