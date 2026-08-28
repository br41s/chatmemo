import {
  BackupAction,
  backupFileName,
  backupReducer,
  BackupState,
  clearSourceMessage,
  exportSummaryMessage,
  initialBackupState,
  restoreSummaryMessage
} from "../../lib/memory-backup-state"

const run = (state: BackupState, ...actions: BackupAction[]) =>
  actions.reduce(backupReducer, state)

describe("backupReducer", () => {
  it("runs one operation at a time", () => {
    // Both buttons disable on either flag, so a state with both true would
    // deadlock the section until the sheet is reopened.
    const after = run(
      initialBackupState,
      { type: "export-started" },
      { type: "restore-started" }
    )

    expect(after.exporting).toBe(false)
    expect(after.restoring).toBe(true)
  })

  it("clears the last outcome when either one starts", () => {
    const after = run(
      initialBackupState,
      { type: "export-started" },
      { type: "succeeded", message: "Downloaded 2 files — 40 rows total" },
      { type: "export-settled" },
      { type: "restore-started" }
    )

    expect(after.result).toBeNull()
    expect(after.error).toBeNull()
  })

  it("shows a failure or a success, never both", () => {
    const failed = run(
      initialBackupState,
      { type: "export-started" },
      { type: "succeeded", message: "done" },
      { type: "failed", message: "HTTP 500" }
    )

    expect(failed.error).toBe("HTTP 500")
    expect(failed.result).toBeNull()

    const succeeded = run(failed, { type: "succeeded", message: "done" })

    expect(succeeded.result).toBe("done")
    expect(succeeded.error).toBeNull()
  })

  it("settles only the operation that finished", () => {
    const after = run(
      initialBackupState,
      { type: "restore-started" },
      { type: "export-settled" }
    )

    expect(after.restoring).toBe(true)
  })

  it("keeps the message after settling", () => {
    const after = run(
      initialBackupState,
      { type: "export-started" },
      { type: "failed", message: "HTTP 500" },
      { type: "export-settled" }
    )

    expect(after.exporting).toBe(false)
    expect(after.error).toBe("HTTP 500")
  })
})

describe("backupFileName", () => {
  it("names one file per source, dated by the export", () => {
    expect(backupFileName("chatgpt", "2026-08-25T14:03:11.000Z")).toBe(
      "chatmemo-backup-chatgpt-2026-08-25.json"
    )
  })
})

describe("the messages", () => {
  it("counts files and rows", () => {
    expect(exportSummaryMessage(1, 12)).toBe(
      "Downloaded 1 file — 12 rows total"
    )
    expect(exportSummaryMessage(3, 400)).toBe(
      "Downloaded 3 files — 400 rows total"
    )
  })

  it("mentions duplicates only when there were some", () => {
    expect(restoreSummaryMessage(1, 0)).toBe("Restored 1 row")
    expect(restoreSummaryMessage(9, 4)).toBe(
      "Restored 9 rows (4 already existed, skipped)"
    )
  })

  it("names the source it cleared", () => {
    expect(clearSourceMessage("perplexity", 31)).toBe(
      "Perplexity data cleared (31 rows removed)"
    )
  })
})
