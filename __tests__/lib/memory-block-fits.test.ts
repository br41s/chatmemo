/**
 * @jest-environment node
 *
 * The memory block that is actually sent fits the allowance it reports.
 *
 * context-budget.test.ts checks the split. This checks the thing built from
 * it, with every layer saturated — the longest lessons document the rewrite
 * allows, more rows than any layer can take, relevance filled to its limit —
 * through the same functions the injector calls. It is the test that was
 * missing while a "100k" block went out at 115k and an 8k window was handed
 * nearly twice its share.
 */
import {
  MEMORY_OVERHEAD_CHARS,
  resolveContextBudget
} from "@/lib/context-budget"
import { MAX_LESSONS_CHARS } from "@/lib/lessons-rewrite"
import {
  buildSummarySections,
  fitLessons
} from "@/lib/server/get-latest-summary"
import { formatRelevantMemory } from "@/lib/server/get-relevant-memory"
import { buildMemoryBlock } from "@/lib/server/inject-memory"

const row = (content: string) => ({ content, effective_at: "2026-09-01" })

// A lessons document at the rewrite's ceiling, as lines, the way it is kept.
const LESSONS = Array.from(
  { length: Math.ceil(MAX_LESSONS_CHARS / 60) },
  (_, i) => `- Lesson ${i}: ${"x".repeat(45)}`
)
  .join("\n")
  .slice(0, MAX_LESSONS_CHARS)

const INDEX_ROWS = Array.from({ length: 8 }, () => row("i".repeat(6_000)))
const PERSONAL_ROWS = Array.from({ length: 200 }, () => row("p".repeat(2_000)))
const BULK_ROWS = Array.from({ length: 60 }, () => row("b".repeat(1_000)))

/** The relevance layer's own loop: excerpts up to 2,000 chars until the
 *  allowance is spent. */
function saturatedRelevance(allowance: number): string | null {
  const excerpts: string[] = []
  let chars = 0
  for (const size of [2_001, 1_500, 900, 400, 200, 120]) {
    if (chars + size > allowance) continue
    excerpts.push("r".repeat(size))
    chars += size
  }
  return excerpts.length > 0 ? formatRelevantMemory(excerpts) : null
}

const MISS_SENTINEL =
  "[FULL CONVERSATION RETRIEVAL — no matching conversation found]\n" +
  "No stored conversation matched the requested title/date. Ask the user " +
  "to confirm the exact title, date, or source (in-app, Perplexity, " +
  "ChatGPT, Claude). Do not invent content.\n" +
  "[/FULL CONVERSATION RETRIEVAL]"

const WINDOWS = [6_000, 8_192, 16_000, 32_000, 64_000, 128_000, 200_000]

describe("the assembled memory block", () => {
  it.each(WINDOWS)("fits its allowance with every layer full: %d", w => {
    const budget = resolveContextBudget({
      windowTokens: w,
      requestedHistoryTokens: 4_096
    })
    const summary = buildSummarySections(
      LESSONS,
      INDEX_ROWS,
      PERSONAL_ROWS,
      BULK_ROWS,
      budget
    )
    const block = buildMemoryBlock(
      summary,
      null,
      saturatedRelevance(budget.relevantChars)
    )

    expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
  })

  it.each(WINDOWS)(
    "still fits when a recovery request found nothing: %d",
    w => {
      const budget = resolveContextBudget({
        windowTokens: w,
        requestedHistoryTokens: 4_096
      })
      const summary = buildSummarySections(
        LESSONS,
        INDEX_ROWS,
        PERSONAL_ROWS,
        BULK_ROWS,
        budget
      )
      // On a miss the sentinel rides along with the whole baseline.
      const block = buildMemoryBlock(
        summary,
        MISS_SENTINEL,
        saturatedRelevance(budget.relevantChars)
      )

      expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
    }
  )

  it.each(WINDOWS)("fits with a recovered transcript in it: %d", w => {
    const budget = resolveContextBudget({
      windowTokens: w,
      requestedHistoryTokens: 4_096
    })
    // Three conversations filling the transcript allowance, joined and
    // wrapped the way get-full-conversation writes them.
    const each = Math.floor(budget.fullConversationChars / 3)
    const transcript =
      "[FULL CONVERSATION RETRIEVAL — 3 match(es), verbatim source of truth]\n" +
      [0, 1, 2].map(() => "t".repeat(each)).join("\n\n") +
      "\n[/FULL CONVERSATION RETRIEVAL]"
    // A hit drops the baseline and the relevance layer.
    const block = buildMemoryBlock(null, transcript, null)

    expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
  })

  it("keeps the overhead reserve above what the block really adds", () => {
    // Instructions, tags and section wrappers with no memory in them at all.
    const empty = buildMemoryBlock(
      "[LESSONS — Accumulated knowledge about you from past sessions]\n\n[/LESSONS]\n\n[CONVERSATION HISTORY — newest entries first]\n\n[/CONVERSATION HISTORY]",
      MISS_SENTINEL,
      formatRelevantMemory([])
    )
    expect(empty.length).toBeLessThan(MEMORY_OVERHEAD_CHARS)
  })

  it("sends a large window the same layers as before, lessons whole", () => {
    const budget = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })
    const summary = buildSummarySections(
      LESSONS,
      [],
      PERSONAL_ROWS,
      BULK_ROWS,
      budget
    )!

    expect(summary).toContain(LESSONS)
    expect(summary).not.toContain("left out to fit")
    // What the fixed 80k and 20k budgets gave: each row is its capped text,
    // the ellipsis, and the date header it is given.
    const header = "### [2026-09-01]\n".length
    const personalRow = "p".repeat(1_500) + "…"
    const bulkRow = "b".repeat(400) + "…"
    expect(summary.split(personalRow).length - 1).toBe(
      Math.floor(80_000 / (header + personalRow.length))
    )
    expect(summary.split(bulkRow).length - 1).toBe(
      Math.floor(20_000 / (header + bulkRow.length))
    )
  })
})

describe("fitLessons", () => {
  const doc = "- First lesson\n- Second lesson\n- Third lesson that is longer"

  it("returns the document untouched when it fits", () => {
    expect(fitLessons(doc, doc.length)).toBe(doc)
  })

  it("cuts at a line break, from the end, and says so", () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `- Lesson number ${i}`
    ).join("\n")
    const fitted = fitLessons(long, 300)!

    expect(fitted.length).toBeLessThanOrEqual(300)
    expect(fitted.startsWith("- Lesson number 0\n")).toBe(true)
    expect(fitted).toContain("left out to fit this model's context window")
    // Every line kept is a whole line of the original.
    const kept = fitted.split("\n").slice(0, -1)
    expect(kept.every(line => long.split("\n").includes(line))).toBe(true)
  })

  it("never exceeds the allowance, whatever the allowance", () => {
    const long = "- " + "word ".repeat(2_000)
    for (const max of [0, 1, 50, 80, 120, 500, 5_000]) {
      const fitted = fitLessons(long, max)
      expect((fitted ?? "").length).toBeLessThanOrEqual(max)
    }
  })

  it("leaves lessons out when not even the note would fit", () => {
    expect(fitLessons("- " + "x".repeat(500), 40)).toBeNull()
    expect(fitLessons("   ", 1_000)).toBeNull()
  })
})
