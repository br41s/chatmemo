/**
 * @jest-environment node
 *
 * Tests for lib/memory-report.ts — what the server tells the browser about the
 * memory a turn was given.
 *
 * Two things must hold. The report has to describe the block accurately, since
 * its whole purpose is letting a reader check an answer against what the model
 * was actually shown. And it must never be able to break a chat response: a
 * report that cannot be encoded degrades to no indicator, not to a failed turn.
 */
import {
  buildMemoryReport,
  decodeMemoryReport,
  encodeMemoryReport,
  MemoryReport
} from "@/lib/memory-report"

const LESSONS = "[LESSONS — about you]\n- Ships on Fridays\n[/LESSONS]"
const HISTORY = (entries: string[]) =>
  `[CONVERSATION HISTORY — newest entries first]\n${entries.join(
    "\n\n---\n\n"
  )}\n[/CONVERSATION HISTORY]`

describe("buildMemoryReport", () => {
  it("reports nothing injected when nothing was", () => {
    const report = buildMemoryReport({
      summary: null,
      relevant: null,
      fullConversation: null,
      fullConversationMissed: false,
      totalChars: 0,
      budgetChars: 100_000
    })

    expect(report.injected).toBe(false)
    expect(report.lessons).toBeUndefined()
    expect(report.history).toBeUndefined()
  })

  it("separates lessons from conversation history", () => {
    const summary = `${LESSONS}\n\n${HISTORY(["one", "two", "three"])}`
    const report = buildMemoryReport({
      summary,
      relevant: null,
      fullConversation: null,
      fullConversationMissed: false,
      totalChars: summary.length,
      budgetChars: 100_000
    })

    expect(report.lessons?.chars).toBeGreaterThan(0)
    expect(report.history?.entries).toBe(3)
    expect(report.injected).toBe(true)
  })

  it("reports lessons alone when there is no history", () => {
    const report = buildMemoryReport({
      summary: LESSONS,
      relevant: null,
      fullConversation: null,
      fullConversationMissed: false,
      totalChars: LESSONS.length,
      budgetChars: 100_000
    })

    expect(report.lessons).toBeDefined()
    expect(report.history).toBeUndefined()
  })

  it("counts relevance matches", () => {
    const relevant = "[RELEVANT MEMORY]\na\n\n---\n\nb\n[/RELEVANT MEMORY]"
    const report = buildMemoryReport({
      summary: null,
      relevant,
      fullConversation: null,
      fullConversationMissed: false,
      totalChars: relevant.length,
      budgetChars: 6_000
    })

    expect(report.relevant?.entries).toBe(2)
  })

  it("distinguishes a recovered transcript from a failed recovery", () => {
    const hit = buildMemoryReport({
      summary: null,
      relevant: null,
      fullConversation: "[FULL CONVERSATION RETRIEVAL]…transcript…",
      fullConversationMissed: false,
      totalChars: 40,
      budgetChars: 120_000
    })
    expect(hit.fullConversation).toBeDefined()
    expect(hit.fullConversationMissed).toBeUndefined()

    const miss = buildMemoryReport({
      summary: null,
      relevant: null,
      fullConversation: "[FULL CONVERSATION RETRIEVAL — no matching…]",
      fullConversationMissed: true,
      totalChars: 44,
      budgetChars: 120_000
    })
    // A miss is worth surfacing: the model was told to say so rather than
    // reconstruct the conversation, and the reader should know that happened.
    expect(miss.fullConversationMissed).toBe(true)
    expect(miss.fullConversation).toBeUndefined()
  })
})

describe("encode/decode round trip", () => {
  const report: MemoryReport = {
    injected: true,
    lessons: { chars: 120 },
    history: { chars: 8_000, entries: 12 },
    relevant: { chars: 900, entries: 2 },
    totalChars: 9_020,
    budgetChars: 100_000
  }

  it("survives the header round trip", () => {
    const encoded = encodeMemoryReport(report)
    expect(encoded).not.toBeNull()
    expect(decodeMemoryReport(encoded)).toEqual(report)
  })

  it("produces an ASCII-safe header value", () => {
    const encoded = encodeMemoryReport({
      ...report,
      // Titles and excerpts can carry non-ASCII; the header cannot.
      history: { chars: 10, entries: 1 }
    })!
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/)
  })
})

describe("decodeMemoryReport — never breaks the turn", () => {
  it.each([
    ["missing", null],
    ["empty", ""],
    ["not base64", "!!!not base64!!!"],
    ["base64 of nonsense", btoa("not json at all")],
    ["base64 of a non-object", btoa("42")],
    ["an object without the marker field", btoa(JSON.stringify({ a: 1 }))]
  ])("returns null for a %s header", (_label, value) => {
    expect(decodeMemoryReport(value as string | null)).toBeNull()
  })
})
