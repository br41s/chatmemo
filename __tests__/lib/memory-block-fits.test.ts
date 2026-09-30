/**
 * @jest-environment node
 *
 * The memory block that is actually sent fits the allowance it reports.
 *
 * context-budget.test.ts checks the split. This checks the thing built from
 * it, through the same functions the injector calls. It is the test that was
 * missing while a "100k" block went out at 115k and an 8k window was handed
 * nearly twice its share.
 *
 * Two different worst cases, because they pull in opposite directions: every
 * layer filled to its allowance (the most counted content), and as many
 * entries as the database can return (the most uncounted separators).
 */
import {
  MAX_LESSONS_BUDGET_CHARS,
  MEMORY_OVERHEAD_CHARS,
  resolveContextBudget
} from "@/lib/context-budget"
import { fillLayer } from "@/lib/server/cut-to-fit"
import {
  buildSummarySections,
  fitLessons,
  MAX_BULK_ROWS,
  MAX_INDEX_ROWS,
  MAX_PERSONAL_ROWS
} from "@/lib/server/get-latest-summary"
import {
  formatRelevantMemory,
  MAX_RELEVANT_ROWS
} from "@/lib/server/get-relevant-memory"
import { NO_FULL_MATCH_MARKER } from "@/lib/server/get-full-conversation"
import {
  buildMemoryBlock,
  isFullConversationMiss
} from "@/lib/server/inject-memory"

const row = (content: string) => ({ content, effective_at: "2026-09-01" })
const DATE_HEADER = "### [2026-09-01]\n".length

/** A lessons document of a given size, as lines, the way it is kept. */
const lessonsOf = (chars: number) =>
  Array.from(
    { length: Math.ceil(chars / 60) },
    (_, i) => `- Lesson ${i}: ${"x".repeat(45)}`
  )
    .join("\n")
    .slice(0, chars)

// The longest document a rewrite can produce.
const LESSONS = lessonsOf(MAX_LESSONS_BUDGET_CHARS)

const INDEX_ROWS = Array.from({ length: 8 }, () => row("i".repeat(6_000)))
const PERSONAL_ROWS = Array.from({ length: 200 }, () => row("p".repeat(2_000)))
const BULK_ROWS = Array.from({ length: 60 }, () => row("b".repeat(1_000)))

/** The relevance layer, through its own admission rule: the top rows, each
 *  up to 2,000 chars and an ellipsis, until the allowance is spent. */
function relevance(allowance: number, rowChars = 2_000): string | null {
  const excerpts = fillLayer(
    Array.from({ length: MAX_RELEVANT_ROWS }, () => "r".repeat(rowChars) + "…"),
    allowance
  )
  return excerpts.length > 0 ? formatRelevantMemory(excerpts) : null
}

const MISS_SENTINEL =
  `[FULL CONVERSATION RETRIEVAL — ${NO_FULL_MATCH_MARKER}]\n` +
  "No stored conversation matched the requested title/date. Ask the user " +
  "to confirm the exact title, date, or source (in-app, Perplexity, " +
  "ChatGPT, Claude). Do not invent content.\n" +
  "[/FULL CONVERSATION RETRIEVAL]"

const budgetFor = (windowTokens: number) =>
  resolveContextBudget({ windowTokens, requestedHistoryTokens: 4_096 })

// 4,100 sits just above the point where there is room for the block's own
// text and nothing else; the rest step up to a window at the ceiling.
const WINDOWS = [4_100, 6_000, 8_192, 16_000, 32_000, 64_000, 128_000, 200_000]

describe("the assembled memory block — every layer full", () => {
  it.each(WINDOWS)("fits its allowance: %d", w => {
    const budget = budgetFor(w)
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
      relevance(budget.relevantChars)
    )

    expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
  })

  it.each(WINDOWS)(
    "still fits when a recovery request found nothing: %d",
    w => {
      const budget = budgetFor(w)
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
        relevance(budget.relevantChars)
      )

      expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
    }
  )

  it.each(WINDOWS)("fits with a recovered transcript in it: %d", w => {
    const budget = budgetFor(w)
    // Conversations filling the transcript allowance exactly, joined and
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
})

describe("the assembled memory block — as many entries as there can be", () => {
  // Separators between entries are not counted against any layer; the
  // overhead reserve has to cover them. They are most numerous when every row
  // the queries can return is admitted, which needs small rows, not large.
  it("keeps everything uncounted inside the overhead reserve", () => {
    const budget = budgetFor(200_000)
    const index = Array.from({ length: MAX_INDEX_ROWS }, () => row("i"))
    const personal = Array.from({ length: MAX_PERSONAL_ROWS }, () => row("p"))
    const bulk = Array.from({ length: MAX_BULK_ROWS }, () => row("b"))
    const lessons = "- one lesson"
    const excerpts = Array.from({ length: MAX_RELEVANT_ROWS }, () => "r")

    const block = buildMemoryBlock(
      buildSummarySections(lessons, index, personal, bulk, budget),
      MISS_SENTINEL,
      formatRelevantMemory(excerpts)
    )

    // What the layers were billed for: each entry's own text, and the date
    // header the personal and bulk rows are given.
    const counted =
      lessons.length +
      MAX_INDEX_ROWS +
      (MAX_PERSONAL_ROWS + MAX_BULK_ROWS) * (DATE_HEADER + 1) +
      MAX_RELEVANT_ROWS

    expect(block).toContain("[LESSONS")
    expect(block.split("\n\n---\n\n").length - 1).toBe(
      MAX_INDEX_ROWS +
        MAX_PERSONAL_ROWS +
        MAX_BULK_ROWS -
        1 +
        MAX_RELEVANT_ROWS -
        1
    )
    expect(block.length - counted).toBeLessThanOrEqual(MEMORY_OVERHEAD_CHARS)
  })

  it("fits with every row admitted and the large layers full", () => {
    const budget = budgetFor(200_000)
    // Personal rows sized so that all of them fit the allowance exactly.
    const personalRow = Math.floor(budget.personalChars / MAX_PERSONAL_ROWS)
    const indexRow = Math.floor(budget.indexChars / MAX_INDEX_ROWS)
    const summary = buildSummarySections(
      LESSONS,
      Array.from({ length: MAX_INDEX_ROWS }, () => row("i".repeat(indexRow))),
      Array.from({ length: MAX_PERSONAL_ROWS }, () =>
        row("p".repeat(personalRow - DATE_HEADER))
      ),
      Array.from({ length: MAX_BULK_ROWS }, () => row("b".repeat(1_000))),
      budget
    )!
    const block = buildMemoryBlock(
      summary,
      MISS_SENTINEL,
      relevance(budget.relevantChars, 1_499)
    )

    expect(
      summary.split("p".repeat(personalRow - DATE_HEADER)).length - 1
    ).toBe(MAX_PERSONAL_ROWS)
    expect(block.length).toBeLessThanOrEqual(budget.memoryChars)
  })
})

describe("the assembled memory block — large windows are unchanged", () => {
  const budget = resolveContextBudget({
    windowTokens: 128_000,
    requestedHistoryTokens: 4_096,
    outputTokens: 4_096
  })

  it("sends the lessons document whole, up to the longest a rewrite can write", () => {
    const summary = buildSummarySections(LESSONS, [], [], [], budget)!
    expect(summary).toContain(LESSONS)
    expect(summary).not.toContain("left out to fit")
  })

  it("admits what the fixed 80k, 20k and 10k budgets admitted", () => {
    const summary = buildSummarySections(
      null,
      INDEX_ROWS,
      PERSONAL_ROWS,
      BULK_ROWS,
      budget
    )!
    // Each row is its capped text, the ellipsis, and for personal and bulk
    // rows the date header.
    const indexRow = "i".repeat(4_000) + "…"
    const personalRow = "p".repeat(1_500) + "…"
    const bulkRow = "b".repeat(400) + "…"

    expect(summary.split(indexRow).length - 1).toBe(
      Math.floor(10_000 / indexRow.length)
    )
    expect(summary.split(personalRow).length - 1).toBe(
      Math.floor(80_000 / (DATE_HEADER + personalRow.length))
    )
    expect(summary.split(bulkRow).length - 1).toBe(
      Math.floor(20_000 / (DATE_HEADER + bulkRow.length))
    )
  })
})

describe("a layer whose first entry does not fit", () => {
  it("cuts a personal row to the allowance instead of leaving history empty", () => {
    // Just above the no-room threshold: the personal allowance is smaller
    // than one full row.
    const budget = budgetFor(6_000)
    expect(budget.personalChars).toBeLessThan(DATE_HEADER + 1_501)
    expect(budget.personalChars).toBeGreaterThanOrEqual(200)

    const summary = buildSummarySections(null, [], PERSONAL_ROWS, [], budget)!

    expect(summary).toContain("[CONVERSATION HISTORY")
    expect(summary).toContain("### [2026-09-01]\nppp")
    // One row, cut — not two, and not none.
    expect(summary.split("### [2026-09-01]").length - 1).toBe(1)
  })

  it("leaves the layer out when what is left is too small to say anything", () => {
    const budget = budgetFor(4_100)
    expect(budget.personalChars).toBeLessThan(200)
    expect(buildSummarySections(null, [], PERSONAL_ROWS, [], budget)).toBeNull()
  })
})

describe("isFullConversationMiss", () => {
  it("recognises the sentinel", () => {
    expect(isFullConversationMiss(MISS_SENTINEL)).toBe(true)
  })

  it("is not fooled by a transcript that contains the sentinel's words", () => {
    // A recovered conversation about this very feature. Taken for a miss, it
    // had the whole baseline added on top of it.
    const transcript =
      "[FULL CONVERSATION RETRIEVAL — 1 match(es), verbatim source of truth]\n" +
      `user: why did it say "${NO_FULL_MATCH_MARKER}"?\n` +
      "[/FULL CONVERSATION RETRIEVAL]"
    expect(isFullConversationMiss(transcript)).toBe(false)
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
