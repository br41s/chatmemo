import {
  addImportTotals,
  emptyImportTotals,
  ImportState,
  importReducer,
  importSummaryMessage,
  initialImportState
} from "../../lib/memory-import-state"

const run = (
  state: ImportState,
  ...actions: Parameters<typeof importReducer>[1][]
) => actions.reduce(importReducer, state)

describe("importReducer", () => {
  it("counts through a multi-file selection but not a single file", () => {
    const many = importReducer(initialImportState, {
      type: "started",
      source: "chatgpt",
      fileCount: 3
    })
    expect(many.progress).toEqual({ current: 1, total: 3 })

    const one = importReducer(initialImportState, {
      type: "started",
      source: "claude",
      fileCount: 1
    })
    expect(one.progress).toBeNull()
    expect(one.source).toBe("claude")
  })

  it("clears the previous run's outcome when a new one starts", () => {
    const after = run(
      initialImportState,
      { type: "started", source: "chatgpt", fileCount: 1 },
      { type: "succeeded", totals: { ...emptyImportTotals(), inserted: 4 } },
      { type: "settled" },
      { type: "started", source: "claude", fileCount: 1 }
    )

    expect(after.result).toBeNull()
    expect(after.error).toBeNull()
  })

  it("leaves nothing running after a failure", () => {
    // The rule that matters: a mid-loop failure returns early, and the finally
    // block settles. If `settled` cleared the error too, the reason would
    // vanish the instant it was set.
    const after = run(
      initialImportState,
      { type: "started", source: "perplexity", fileCount: 2 },
      { type: "file", current: 2, total: 2 },
      { type: "failed", message: "File 2/2 (b.json): Network error" },
      { type: "settled" }
    )

    expect(after.source).toBeNull()
    expect(after.progress).toBeNull()
    expect(after.error).toBe("File 2/2 (b.json): Network error")
    expect(after.result).toBeNull()
  })

  it("keeps the result visible after settling", () => {
    const after = run(
      initialImportState,
      { type: "started", source: "chatgpt", fileCount: 1 },
      { type: "succeeded", totals: { ...emptyImportTotals(), inserted: 2 } },
      { type: "settled" }
    )

    expect(after.source).toBeNull()
    expect(after.result?.inserted).toBe(2)
  })
})

describe("addImportTotals", () => {
  it("accumulates across files", () => {
    const totals = addImportTotals(
      addImportTotals(emptyImportTotals(), {
        conversations_found: 2,
        inserted: 2
      }),
      { conversations_found: 3, inserted: 1, skipped: 4 }
    )

    expect(totals).toEqual({
      conversations_found: 5,
      chunks_processed: 0,
      skipped: 4,
      inserted: 3
    })
  })

  it("treats a missing or non-numeric field as zero", () => {
    // The routes return JSON; a field that came back null must not turn the
    // running total into NaN and every later message into "NaN entries".
    const totals = addImportTotals(emptyImportTotals(), {
      inserted: null,
      skipped: "7"
    })

    expect(totals).toEqual(emptyImportTotals())
  })
})

describe("importSummaryMessage", () => {
  it("says what landed and what was already there", () => {
    expect(
      importSummaryMessage({
        conversations_found: 3,
        chunks_processed: 9,
        skipped: 2,
        inserted: 5
      })
    ).toBe(
      "Imported 5 memory entries from 3 conversations (2 already imported, skipped)"
    )
  })

  it("gets the singulars right", () => {
    expect(
      importSummaryMessage({
        conversations_found: 1,
        chunks_processed: 1,
        skipped: 0,
        inserted: 1
      })
    ).toBe("Imported 1 memory entry from 1 conversation")
  })

  it("distinguishes an empty export from an all-duplicate one", () => {
    const nothingNew = importSummaryMessage({
      conversations_found: 0,
      chunks_processed: 0,
      skipped: 0,
      inserted: 0
    })
    const allDuplicates = importSummaryMessage({
      conversations_found: 4,
      chunks_processed: 4,
      skipped: 4,
      inserted: 0
    })

    expect(nothingNew).toContain("nothing new to save")
    expect(allDuplicates).toContain("4 already imported, skipped")
    expect(allDuplicates).not.toContain("nothing new to save")
  })
})
