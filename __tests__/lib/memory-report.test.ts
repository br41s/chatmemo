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

const RELEVANT = (entries: string[]) =>
  `[RELEVANT MEMORY — top matches for the current question, verbatim from your history]\n${entries.join(
    "\n\n---\n\n"
  )}\n[/RELEVANT MEMORY]`

describe("buildMemoryReport — remembered entries", () => {
  const build = (relevant: string) =>
    buildMemoryReport({
      summary: null,
      relevant,
      fullConversation: null,
      fullConversationMissed: false,
      totalChars: relevant.length,
      budgetChars: 100_000
    })

  it("names each relevance match with its title, source and date", () => {
    const report = build(
      RELEVANT([
        "[source:chatgpt]\n### [2026-07-04] Vercel deploy saga\n- six failed builds",
        "[source:perplexity]\n### [2026-03-01] Postgres locale on macOS\n- initdb",
        "[source:claude]\n### [2026-09-24] Summaries metadata trigger\n- BEFORE INSERT"
      ])
    )
    expect(report.relevant?.items).toEqual([
      { title: "Vercel deploy saga", source: "chatgpt", date: "2026-07-04" },
      {
        title: "Postgres locale on macOS",
        source: "perplexity",
        date: "2026-03-01"
      },
      {
        title: "Summaries metadata trigger",
        source: "claude-ai",
        date: "2026-09-24"
      }
    ])
    // The header and footer lines are not entries.
    expect(report.relevant?.entries).toBe(3)
  })

  it("tells a Claude Code session apart by its title tag and strips it", () => {
    const report = build(
      RELEVANT([
        "[source:claude]\n### [2026-09-29] [Claude Code] chatmemo\n- fix"
      ])
    )
    expect(report.relevant?.items?.[0]).toEqual({
      title: "chatmemo",
      source: "claude-code",
      date: "2026-09-29"
    })
  })

  it("labels an untagged, undated row as in-app chat with its first line", () => {
    const report = build(RELEVANT(["Talked about the garden plan\n- tomatoes"]))
    expect(report.relevant?.items?.[0]).toEqual({
      title: "Talked about the garden plan",
      source: "chat"
    })
  })

  it("does not take a bullet or bold marker as part of the title", () => {
    const report = build(
      RELEVANT(["- **First conversation** with Perplexity\n- more"])
    )
    expect(report.relevant?.items?.[0].title).toBe(
      "First conversation with Perplexity"
    )
  })

  it("caps the list and the title length", () => {
    const long = "x".repeat(120)
    const report = build(
      RELEVANT(
        Array.from(
          { length: 9 },
          (_, i) => `### [2026-01-0${(i % 9) + 1}] ${long}`
        )
      )
    )
    expect(report.relevant?.entries).toBe(9)
    expect(report.relevant?.items).toHaveLength(6)
    const title = report.relevant?.items?.[0].title ?? ""
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith("…")).toBe(true)
  })
})

describe("encodeMemoryReport — size guard", () => {
  it("drops the entry list before dropping the report", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      title: `${"title ".repeat(9)}${i}`,
      source: "chatgpt" as const,
      date: "2026-01-01"
    }))
    const report: MemoryReport = {
      injected: true,
      totalChars: 10,
      budgetChars: 100,
      relevant: { chars: 10, entries: 6, items }
    }
    const encoded = encodeMemoryReport(report)
    expect(encoded).not.toBeNull()
    expect(decodeMemoryReport(encoded)?.relevant?.items).toEqual(items)

    // Far past any header limit: the counts survive, the titles do not.
    const oversized: MemoryReport = {
      ...report,
      relevant: {
        ...report.relevant!,
        items: Array.from({ length: 6 }, () => ({
          title: "y".repeat(1_000),
          source: "chat" as const
        }))
      }
    }
    const trimmed = decodeMemoryReport(encodeMemoryReport(oversized))
    expect(trimmed?.relevant?.entries).toBe(6)
    expect(trimmed?.relevant?.items).toBeUndefined()
  })
})
