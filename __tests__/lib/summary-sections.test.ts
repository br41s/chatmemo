/**
 * Tests for buildSummarySections in lib/server/get-latest-summary.ts — the
 * assembly step that turns fetched summary rows plus the lessons document into
 * the baseline memory blob injected on every chat turn.
 *
 * The layer-independence cases are regression tests: the function used to bail
 * out before using `lessons` whenever the user had no personal and no bulk
 * rows, silently dropping the memory layer the instructions block calls the
 * highest-quality signal.
 */
import { buildSummarySections } from "@/lib/server/get-latest-summary"

const row = (content: string | null) => ({ content })

describe("buildSummarySections — layer independence", () => {
  it("injects lessons when the user has no summary rows at all", () => {
    const out = buildSummarySections("- Prefers concise answers", [], [], [])

    expect(out).not.toBeNull()
    expect(out).toContain("[LESSONS")
    expect(out).toContain("- Prefers concise answers")
    expect(out).not.toContain("[CONVERSATION HISTORY")
  })

  it("injects lessons when only index rows survive the queries", () => {
    const out = buildSummarySections(
      "- Ships on Fridays",
      [row("Conversation Index\n[2026-01-02] Trip planning")],
      [],
      []
    )

    expect(out).toContain("- Ships on Fridays")
    expect(out).toContain("Trip planning")
  })

  it("injects history when there are rows but no lessons yet", () => {
    const out = buildSummarySections(null, [], [row("A past session")], [])

    expect(out).toContain("[CONVERSATION HISTORY")
    expect(out).toContain("A past session")
    expect(out).not.toContain("[LESSONS")
  })

  it("returns null only when there is genuinely nothing to inject", () => {
    expect(buildSummarySections(null, [], [], [])).toBeNull()
  })

  it("treats blank-only rows as nothing to inject", () => {
    expect(buildSummarySections(null, [], [row("   "), row(null)], [])).toBeNull()
  })

  it("puts lessons before conversation history", () => {
    const out = buildSummarySections("LESSON_TEXT", [], [row("HISTORY_TEXT")], [])

    expect(out!.indexOf("LESSON_TEXT")).toBeLessThan(
      out!.indexOf("HISTORY_TEXT")
    )
  })
})

describe("buildSummarySections — budgets", () => {
  it("caps personal rows at 1500 chars and bulk rows at 400", () => {
    const out = buildSummarySections(
      null,
      [],
      [row("p".repeat(2_000))],
      [row("b".repeat(1_000))]
    )!

    expect(out).toContain("p".repeat(1_500) + "…")
    expect(out).not.toContain("p".repeat(1_501))
    expect(out).toContain("b".repeat(400) + "…")
    expect(out).not.toContain("b".repeat(401))
  })

  it("stops adding personal rows once the 80k budget is spent", () => {
    // 60 rows × 1500 chars = 90k, so the 80k budget cuts the tail off.
    const rows = Array.from({ length: 60 }, (_, i) =>
      row(`${i}`.padEnd(1_500, "x"))
    )
    const out = buildSummarySections(null, [], rows, [])!

    expect(out).toContain("0".padEnd(1_500, "x"))
    expect(out).not.toContain("59".padEnd(1_500, "x"))
  })

  it("keeps the bulk budget separate from the personal one", () => {
    // A full personal budget must not starve bulk rows — they are billed apart.
    const personal = Array.from({ length: 60 }, () => row("x".repeat(1_500)))
    const out = buildSummarySections(
      null,
      [],
      personal,
      [row("BULK_MARKER conversation")]
    )!

    expect(out).toContain("BULK_MARKER")
  })
})
