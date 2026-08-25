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
  MAX_MEMORY_CHARS,
  MIN_WINDOW_TOKENS,
  resolveContextBudget
} from "@/lib/context-budget"

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

describe("resolveContextBudget — large models keep today's allowance", () => {
  it("resolves the previous 100k memory ceiling on a 128k model at defaults", () => {
    const budget = resolveContextBudget({
      windowTokens: 128_000,
      requestedHistoryTokens: 4_096,
      outputTokens: 4_096
    })

    expect(budget.memoryChars).toBe(MAX_MEMORY_CHARS)
    // The previous hardcoded layer budgets, reproduced.
    expect(budget.personalChars).toBe(80_000)
    expect(budget.bulkChars).toBe(20_000)
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
      resolveContextBudget({ windowTokens: windowTokens as number }).windowTokens
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
