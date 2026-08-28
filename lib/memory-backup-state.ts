// Backup and restore: two operations that share one result line.
//
// Four `useState` calls that had to agree — exporting and restoring each
// disable the other, and both write to the same message — updated by hand in
// two try/catch/finally blocks.

export interface BackupState {
  exporting: boolean
  restoring: boolean
  result: string | null
  error: string | null
}

export type BackupAction =
  | { type: "cleared" }
  | { type: "export-started" }
  | { type: "restore-started" }
  | { type: "succeeded"; message: string }
  | { type: "failed"; message: string }
  | { type: "export-settled" }
  | { type: "restore-settled" }

export const initialBackupState: BackupState = {
  exporting: false,
  restoring: false,
  result: null,
  error: null
}

export function backupReducer(
  state: BackupState,
  action: BackupAction
): BackupState {
  switch (action.type) {
    case "cleared":
      return initialBackupState

    // Starting either one clears the last outcome, so a stale success does not
    // sit above a run that is still going.
    case "export-started":
      return { exporting: true, restoring: false, result: null, error: null }

    case "restore-started":
      return { exporting: false, restoring: true, result: null, error: null }

    case "succeeded":
      return { ...state, result: action.message, error: null }

    case "failed":
      return { ...state, error: action.message, result: null }

    case "export-settled":
      return { ...state, exporting: false }

    case "restore-settled":
      return { ...state, restoring: false }

    default:
      return state
  }
}

/** One file per source, named so a person can tell them apart in Downloads. */
export function backupFileName(source: string, exportedAt: string): string {
  return `chatmemo-backup-${source}-${exportedAt.slice(0, 10)}.json`
}

export function exportSummaryMessage(files: number, rows: number): string {
  return `Downloaded ${files} file${files !== 1 ? "s" : ""} — ${rows} rows total`
}

export function restoreSummaryMessage(
  inserted: number,
  skipped: number
): string {
  const rows = `${inserted} row${inserted !== 1 ? "s" : ""}`
  const duplicates = skipped > 0 ? ` (${skipped} already existed, skipped)` : ""

  return `Restored ${rows}${duplicates}`
}

export function clearSourceMessage(source: string, deleted: number): string {
  const label = source.charAt(0).toUpperCase() + source.slice(1)

  return `${label} data cleared (${deleted} rows removed)`
}
