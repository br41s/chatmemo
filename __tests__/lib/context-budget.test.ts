/**
 * Tests for lib/context-budget.ts — the one split shared by the client's
 * history trimming and the server's memory injection.
 *
 * Two properties matter:
 *   1. The parts never add up to more than the window. That is the bug this
 *      replaces: history was budgeted at 4096 tokens while memory silently
 *      added ~30k on the server.
 *   2. A large-window model still gets what it got before, so bounding the
 *      request does not quietly degrade memory on models that can afford it.
 */
import {
  CHARS_PER_TOKEN,
  DEFAULT_WINDOW_TOKENS,
  MAX_LESSONS_BUDGET_CHARS,
  MAX_MEMORY_CHARS,
  MEMORY_OVERHEAD_CHARS,
  MIN_WINDOW_TOKENS,
  resolveContextBudget
} from "@/lib/context-budget"
import {
  lessonsRewriteMaxTokens,
  MAX_LESSONS_CHARS
} from "@/lib/lessons-rewrite"

const totalTokens = (b: ReturnType<typeof resolveContextBudget>) =>
  b.outputTokens + b.historyTokens + Math.ceil(b.memoryChars / CHARS_PER_TOKEN)

describe("resolveContextBudget — the parts fit the whole", () => {
  it.each([
    ["a small window", 8_192, 4_096],
    ["a mid window", 32_000, 4_096],
    ["a large window", 128_000, 4_096],
    ["a very large window", 200_000, 8_192],
    ["history larger than the window", 8_192, 999_999],
    ["no history requested", 16_000, null]
  ])("never exceeds the window: %s", (_label, windowTokens, history) => {
    const budget = resolveContextBudget({
      windowTokens,
      requestedHistoryTokens: history
    })
    expect(totalTokens(budget)).toBeLessThanOrEqual(budget.windowTokens)
  })

  it("leaves room for memory even when history asks for everything", () => {
    const budget = resolveContextBudget({
      windowTokens: 8_192,
      requestedHistoryTokens: 8_192
    })
    expect(budget.memoryChars).toBeGreaterThan(0)
    expect(budget.historyTokens).toBeLessThan(8_192)
  })
})

describe("CHARS_PER_TOKEN", () => {
  it("is at or below the smallest ratio measured on real memory", () => {
    // 3.60 chars per token for the Perplexity rows, measured with
    // gpt-tokenizer on 1,338 rows. Above it, a full block on a window below
    // the ceiling is more tokens than the split reserved for it.
    expect(CHARS_PER_TOKEN).toBeLessThanOrEqual(3.6)
    expect(CHARS_PER_TOKEN).toBeGreaterThanOrEqual(3)
  })
})

describe("resolveContextBudget — the layers fit the block", () => {
  // The first property above is about the numbers this function reports. This
  // one is about whether a block built to those numbers can honour them: the
  // layer allowances used to be shares that added up to 116% of memoryChars,
  // with lessons and the instructions on top, so the reported split fitted the
  // window and the block sent did not.
  const windows = [2_048, 4_096, 8_192, 16_000, 32_000, 64_000, 128_000, 1e6]

  it.each(windows)(
    "overhead, lessons and the four layers sum to no more than the block: %d",
    windowTokens => {
      const b = resolveContextBudget({
        windowTokens,
        requestedHistoryTokens: 4_096
      })
      const steadyState =
        b.lessonsChars +
        b.indexChars +
        b.personalChars +
        b.bulkChars +
        b.relevantChars
      if (b.memoryChars > MEMORY_OVERHEAD_CHARS) {
        expect(MEMORY_OVERHEAD_CHARS + steadyState).toBeLessThanOrEqual(
          b.memoryChars
        )
      } else {
        // Not even room for the block's own text: nothing is allotted.
        expect(steadyState).toBe(0)
      }
    }
  )

  it.each(windows)(
    "a recovered transcript takes the content's place, not more: %d",
    windowTokens => {
      const b = resolveContextBudget({
        windowTokens,
        requestedHistoryTokens: 4_096
      })
      expect(b.fullConversationChars).toBeLessThanOrEqual(
        Math.max(b.memoryChars - MEMORY_OVERHEAD_CHARS, 0)
      )
    }
  )

  it("gives lessons room for the longest document a rewrite can write", () => {
    // Not the size at which rewrites stop being attempted: that bounds the
    // document going in. The one coming out can be as long as the rewrite's
    // output allowance, and a window with room must still get it whole.
    const rewriteOutputChars =
      lessonsRewriteMaxTokens("x".repeat(1_000_000)) * CHARS_PER_TOKEN
    expect(MAX_LESSONS_BUDGET_CHARS).toBeGreaterThanOrEqual(rewriteOutputChars)
    expect(MAX_LESSONS_BUDGET_CHARS).toBeGreaterThan(MAX_LESSONS_CHARS)

    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })
    expect(large.lessonsChars).toBe(MAX_LESSONS_BUDGET_CHARS)
  })

  it("keeps lessons from taking the whole of a small window's share", () => {
    const small = resolveContextBudget({
      windowTokens: 8_192,
      requestedHistoryTokens: 4_096
    })
    expect(small.lessonsChars).toBeGreaterThan(0)
    expect(small.lessonsChars).toBeLessThan(small.personalChars)
  })
})

describe("resolveContextBudget — large models keep today's allowance", () => {
  it("resolves the previous layer sizes on a 128k model at defaults", () => {
    const budget = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })

    expect(budget.memoryChars).toBe(MAX_MEMORY_CHARS)
    // The previous hardcoded layer budgets, reproduced.
    expect(budget.personalChars).toBe(80_000)
    expect(budget.bulkChars).toBe(20_000)
    expect(budget.indexChars).toBe(10_000)
    expect(budget.relevantChars).toBe(6_000)
    expect(budget.fullConversationChars).toBe(120_000)
  })

  it("still honours the user's history setting on a large model", () => {
    const budget = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096
    })
    expect(budget.historyTokens).toBe(4_096)
  })
})

describe("resolveContextBudget — small models shrink memory instead of overflowing", () => {
  it("gives a small window a proportionally small memory block", () => {
    const small = resolveContextBudget({
      windowTokens: 8_192,
      requestedHistoryTokens: 4_096
    })
    const large = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096
    })

    expect(small.memoryChars).toBeLessThan(large.memoryChars)
    expect(small.memoryChars).toBeGreaterThan(0)
  })

  it("caps history at half of what is left after the reply", () => {
    const budget = resolveContextBudget({
      windowTokens: 8_192,
      requestedHistoryTokens: 100_000,
      outputTokens: 2_048
    })
    const available = budget.windowTokens - budget.outputTokens
    expect(budget.historyTokens).toBeLessThanOrEqual(
      Math.floor(available * 0.5)
    )
  })

  it("never lets the reply claim more than a quarter of the window", () => {
    const budget = resolveContextBudget({
      windowTokens: 8_192,
      outputTokens: 8_000
    })
    expect(budget.outputTokens).toBeLessThanOrEqual(8_192 * 0.25)
  })
})

describe("resolveContextBudget — untrusted input", () => {
  it("falls back to the conservative default with no input at all", () => {
    expect(resolveContextBudget().windowTokens).toBe(DEFAULT_WINDOW_TOKENS)
    expect(resolveContextBudget({}).windowTokens).toBe(DEFAULT_WINDOW_TOKENS)
  })

  it.each([
    ["negative", -1],
    ["zero", 0],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["below the floor", 10]
  ])("falls back for a %s window", (_label, windowTokens) => {
    expect(
      resolveContextBudget({ windowTokens: windowTokens as number })
        .windowTokens
    ).toBe(DEFAULT_WINDOW_TOKENS)
  })

  it("clamps an absurd window rather than trusting it", () => {
    const budget = resolveContextBudget({ windowTokens: 10 ** 12 })
    expect(budget.windowTokens).toBeLessThanOrEqual(2_000_000)
    // And the memory ceiling still applies on top.
    expect(budget.memoryChars).toBe(MAX_MEMORY_CHARS)
  })

  it("accepts the minimum window", () => {
    const budget = resolveContextBudget({ windowTokens: MIN_WINDOW_TOKENS })
    expect(budget.windowTokens).toBe(MIN_WINDOW_TOKENS)
    expect(totalTokens(budget)).toBeLessThanOrEqual(MIN_WINDOW_TOKENS)
  })

  it("ignores a fractional window's fraction", () => {
    expect(resolveContextBudget({ windowTokens: 8_192.9 }).windowTokens).toBe(
      8_192
    )
  })
})
