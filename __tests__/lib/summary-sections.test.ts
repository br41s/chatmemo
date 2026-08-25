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
import { resolveContextBudget } from "@/lib/context-budget"

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
      [row("b".repeat(1_000))],
      resolveContextBudget({ windowTokens: 128_000, outputTokens: 4_096 })
    )!

    expect(out).toContain("p".repeat(1_500) + "…")
    expect(out).not.toContain("p".repeat(1_501))
    expect(out).toContain("b".repeat(400) + "…")
    expect(out).not.toContain("b".repeat(401))
  })

  it("stops adding personal rows once the budget is spent", () => {
    // 60 rows x 1500 chars = 90k, past the 80k personal budget a large model
    // resolves to, so the tail is cut off.
    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })
    const rows = Array.from({ length: 60 }, (_, i) =>
      row(`${i}`.padEnd(1_500, "x"))
    )
    const out = buildSummarySections(null, [], rows, [], large)!

    expect(out).toContain("0".padEnd(1_500, "x"))
    expect(out).not.toContain("59".padEnd(1_500, "x"))
  })

  it("keeps the bulk budget separate from the personal one", () => {
    // A full personal budget must not starve bulk rows — they are billed apart.
    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })
    const personal = Array.from({ length: 60 }, () => row("x".repeat(1_500)))
    const out = buildSummarySections(
      null,
      [],
      personal,
      [row("BULK_MARKER conversation")],
      large
    )!

    expect(out).toContain("BULK_MARKER")
  })
})

describe("buildSummarySections — honours the resolved context budget", () => {
  const rows = (n: number, char: string) =>
    Array.from({ length: n }, () => row(char.repeat(1_500)))

  it("shrinks the blob for a small model instead of overflowing it", () => {
    // The same rows, assembled under an 8k-window budget and a 128k one. The
    // small model must get materially less, or the request that used to
    // overflow still overflows.
    const small = resolveContextBudget({
      windowTokens: 8_192,
      requestedHistoryTokens: 4_096
    })
    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })

    const underSmall = buildSummarySections(null, [], rows(80, "p"), [], small)!
    const underLarge = buildSummarySections(null, [], rows(80, "p"), [], large)!

    expect(underSmall.length).toBeLessThan(underLarge.length)
    expect(underSmall.length).toBeLessThanOrEqual(
      small.personalChars + small.bulkChars + 200 // section wrappers
    )
  })

  it("defaults to the conservative window when no budget is passed", () => {
    // The no-argument default is deliberately the 8k assumption, not an
    // unbounded one: an unknown model is exactly the case that used to produce
    // over-limit requests.
    const out = buildSummarySections(null, [], rows(80, "p"), [])!
    const fallback = resolveContextBudget()

    expect(out.length).toBeLessThanOrEqual(
      fallback.personalChars + fallback.bulkChars + 200
    )
  })

  it("gives a large model the same allowance it had before", () => {
    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })

    expect(large.personalChars).toBe(80_000)
    expect(large.bulkChars).toBe(20_000)

    const out = buildSummarySections(null, [], rows(80, "p"), [], large)!
    // 80 rows x 1500 chars = 120k, trimmed to the 80k personal budget.
    expect(out.length).toBeGreaterThan(70_000)
    expect(out.length).toBeLessThan(85_000)
  })
})

describe("buildSummarySections — index rows cannot crowd out content", () => {
  const large = () =>
    resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })

  // Shapes taken from a real database: a Perplexity bulk import wrote one
  // 58k-char date list, and ChatGPT imports wrote fourteen at ~4k each. Index
  // rows used to be injected whole and counted against nothing, so those alone
  // consumed roughly three quarters of the allowance before any conversation
  // was considered.
  const hugeIndex = () => row("[Perplexity Conversation Index]\n" + "i".repeat(58_000))
  const chatgptIndex = () => row("[ChatGPT Conversation Index]\n" + "c".repeat(4_000))

  it("caps a single oversized index row", () => {
    const out = buildSummarySections(null, [hugeIndex()], [], [], large())!
    expect(out.length).toBeLessThan(6_000)
  })

  it("keeps index rows inside their share of the allowance", () => {
    const budget = large()
    const indexes = [hugeIndex(), ...Array.from({ length: 4 }, chatgptIndex)]

    const out = buildSummarySections(null, indexes, [], [], budget)!

    expect(out.length).toBeLessThanOrEqual(budget.indexChars + 200)
  })

  it("leaves the personal budget intact when indexes are huge", () => {
    // The regression that mattered: with 58k of index injected first, the
    // conversations the user actually cares about were squeezed out.
    const budget = large()
    const personal = Array.from({ length: 60 }, (_, i) =>
      row(`${i}`.padEnd(1_500, "p"))
    )

    const withIndexes = buildSummarySections(
      null,
      [hugeIndex(), ...Array.from({ length: 4 }, chatgptIndex)],
      personal,
      [],
      budget
    )!
    const withoutIndexes = buildSummarySections(null, [], personal, [], budget)!

    // The personal content is unaffected by how large the indexes were.
    expect(withIndexes).toContain("0".padEnd(1_500, "p"))
    expect(withIndexes.length - withoutIndexes.length).toBeLessThanOrEqual(
      budget.indexChars + 500
    )
  })

  it("still includes a normal-sized index in full", () => {
    // The claude index in that same database is 704 chars — well under the cap,
    // and it should arrive untouched.
    const small = row("[Claude Conversation Index]\n" + "s".repeat(600))
    const out = buildSummarySections(null, [small], [], [], large())!
    expect(out).toContain("s".repeat(600))
    expect(out).not.toContain("…")
  })
})
