// The import state machine.
//
// Importing an export is a loop over files that can stop part-way, and it was
// four `useState` calls updated by hand at seven points in one 886-line
// component. As a reducer the legal transitions are visible in one place, and
// the "a failure leaves nothing running" rule can be tested instead of assumed.

export type ImportSource = "chatgpt" | "claude" | "perplexity"

export interface ImportTotals {
  conversations_found: number
  chunks_processed: number
  skipped: number
  inserted: number
}

export interface ImportState {
  /** Non-null while an import is running; which one. */
  source: ImportSource | null
  /** Only set for a multi-file selection — a single file has no progress. */
  progress: { current: number; total: number } | null
  result: ImportTotals | null
  error: string | null
}

export type ImportAction =
  | { type: "cleared" }
  | { type: "started"; source: ImportSource; fileCount: number }
  | { type: "file"; current: number; total: number }
  | { type: "failed"; message: string }
  | { type: "succeeded"; totals: ImportTotals }
  /** The loop is over, however it ended. */
  | { type: "settled" }

export const emptyImportTotals = (): ImportTotals => ({
  conversations_found: 0,
  chunks_processed: 0,
  skipped: 0,
  inserted: 0
})

export const initialImportState: ImportState = {
  source: null,
  progress: null,
  result: null,
  error: null
}

export function addImportTotals(
  totals: ImportTotals,
  page: Partial<Record<keyof ImportTotals, unknown>>
): ImportTotals {
  const number = (value: unknown) => (typeof value === "number" ? value : 0)

  return {
    conversations_found:
      totals.conversations_found + number(page.conversations_found),
    chunks_processed: totals.chunks_processed + number(page.chunks_processed),
    skipped: totals.skipped + number(page.skipped),
    inserted: totals.inserted + number(page.inserted)
  }
}

export function importReducer(
  state: ImportState,
  action: ImportAction
): ImportState {
  switch (action.type) {
    case "cleared":
      return initialImportState

    case "started":
      return {
        source: action.source,
        // One file has nothing to count through.
        progress:
          action.fileCount > 1 ? { current: 1, total: action.fileCount } : null,
        result: null,
        error: null
      }

    case "file":
      return {
        ...state,
        progress: { current: action.current, total: action.total }
      }

    case "failed":
      return { ...state, error: action.message }

    case "succeeded":
      return { ...state, result: action.totals, error: null }

    case "settled":
      return { ...state, source: null, progress: null }

    default:
      return state
  }
}

/** What to tell someone once an import finishes. */
export function importSummaryMessage(result: ImportTotals): string {
  const entries = `${result.inserted} memory ${
    result.inserted !== 1 ? "entries" : "entry"
  }`
  const conversations = `${result.conversations_found} conversation${
    result.conversations_found !== 1 ? "s" : ""
  }`
  const skipped =
    result.skipped > 0 ? ` (${result.skipped} already imported, skipped)` : ""
  // Distinguishes "your export held nothing new" from "everything in it was a
  // duplicate", which are different things to a person re-importing an archive.
  const nothing =
    result.inserted === 0 && !result.skipped ? " — nothing new to save" : ""

  return `Imported ${entries} from ${conversations}${skipped}${nothing}`
}
