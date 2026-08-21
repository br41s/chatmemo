/**
 * Tests for lib/summary-metadata.ts — the single classifier for what a
 * summaries row is.
 *
 * The fixtures are shared with
 * `__tests__/migrations/summaries-typed-metadata.integration.sql`, which
 * asserts the same expectations against the SQL backfill in
 * 20260819000000_summaries_typed_metadata.sql. Two implementations of the same
 * rules only stay honest if both are pinned to one table of cases, so any
 * change here must be mirrored there.
 */
import fixtures from "@/__tests__/fixtures/summary-metadata-fixtures.json"
import { classifySummaryContent } from "@/lib/summary-metadata"

const byKey = new Map<string, string>(
  (fixtures as { k: string; c: string }[]).map(f => [f.k, f.c])
)

const content = (key: string): string => {
  const value = byKey.get(key)
  if (value === undefined) throw new Error(`missing fixture: ${key}`)
  return value
}

interface Expected {
  source: string
  kind: string
  title: string | null
  occurredAt: string | null
}

// Mirrors the expected table in the integration SQL, verbatim.
const EXPECTED: Record<string, Expected> = {
  "watermark-claude": {
    source: "claude",
    kind: "watermark",
    title: null,
    occurredAt: null
  },
  "watermark-chatgpt": {
    source: "chatgpt",
    kind: "watermark",
    title: null,
    occurredAt: null
  },
  "watermark-perplexity": {
    source: "perplexity",
    kind: "watermark",
    title: null,
    occurredAt: null
  },
  "watermark-unknown": {
    source: "other",
    kind: "watermark",
    title: null,
    occurredAt: null
  },
  "index-claude": {
    source: "claude",
    kind: "index",
    title: null,
    occurredAt: null
  },
  "index-chatgpt": {
    source: "chatgpt",
    kind: "index",
    title: null,
    occurredAt: null
  },
  "index-perplexity": {
    source: "perplexity",
    kind: "index",
    title: null,
    occurredAt: null
  },
  "index-marker-midtext": {
    source: "claude",
    kind: "index",
    title: null,
    occurredAt: null
  },
  "tagged-claude-conv": {
    source: "claude",
    kind: "conversation",
    title: "Qatar flight change",
    occurredAt: "2026-03-01"
  },
  "tagged-chatgpt-conv": {
    source: "chatgpt",
    kind: "conversation",
    title: "Tax questions",
    occurredAt: "2025-11-05"
  },
  "tagged-perplexity-conv": {
    source: "perplexity",
    kind: "conversation",
    title: "Phuket hotels",
    occurredAt: "2025-07-04"
  },
  "tagged-chatgpt-summary": {
    source: "chatgpt",
    kind: "summary",
    title: "Tax questions",
    occurredAt: "2025-11-05"
  },
  "tagged-perplexity-summary": {
    source: "perplexity",
    kind: "summary",
    title: "Some compact summary text",
    occurredAt: null
  },
  "untagged-with-header": {
    source: "claude",
    kind: "conversation",
    title: "Christmas planning",
    occurredAt: "2024-12-24"
  },
  "untagged-plain": {
    source: "other",
    kind: "conversation",
    title: "User prefers concise answers and ships on Fridays.",
    occurredAt: null
  },
  "untagged-heading-line": {
    source: "other",
    kind: "conversation",
    title: "My notes",
    occurredAt: null
  },
  "header-no-title": {
    source: "claude",
    kind: "conversation",
    title: "body only",
    occurredAt: "2026-02-02"
  },
  blank: {
    source: "other",
    kind: "conversation",
    title: null,
    occurredAt: null
  },
  "long-first-line": {
    source: "other",
    kind: "conversation",
    title: "A".repeat(200),
    occurredAt: null
  },
  "tagged-unknown-source": {
    source: "other",
    kind: "conversation",
    title: "Something",
    occurredAt: "2026-05-05"
  }
}

describe("classifySummaryContent", () => {
  it("covers every shared fixture", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...byKey.keys()].sort())
  })

  it.each(Object.keys(EXPECTED))("classifies %s", key => {
    const actual = classifySummaryContent(content(key))
    expect({
      source: actual.source,
      kind: actual.kind,
      title: actual.title,
      occurredAt: actual.occurredAt
    }).toEqual(EXPECTED[key])
  })
})

describe("classifySummaryContent — the predicate that used to drift", () => {
  // get-latest-summary excluded watermarks with `[chatmemo:%]%`, while
  // get-relevant-memory and get-full-conversation used `[chatmemo:%`. Both
  // matched a real watermark, but nothing kept them in step. One classifier
  // means one answer.
  it("recognises a watermark regardless of what follows the prefix", () => {
    for (const raw of [
      "[chatmemo:watermark:source=claude ts=1]",
      "[chatmemo:watermark:source=claude ts=999999999999]",
      "[chatmemo:watermark:source=chatgpt ts=0]"
    ]) {
      expect(classifySummaryContent(raw).kind).toBe("watermark")
    }
  })

  it("does not mistake ordinary content mentioning chatmemo for a watermark", () => {
    const row = classifySummaryContent("I was using chatmemo:watermark today")
    expect(row.kind).toBe("conversation")
  })
})

describe("classifySummaryContent — totality", () => {
  it("returns a usable record for any string", () => {
    for (const raw of ["", "   ", "\n\n", "###", "[source:]", "[]"]) {
      const m = classifySummaryContent(raw)
      expect(["claude", "chatgpt", "perplexity", "other"]).toContain(m.source)
      expect(["conversation", "summary", "index", "watermark"]).toContain(
        m.kind
      )
    }
  })

  it("caps a long title at 200 characters", () => {
    const m = classifySummaryContent("B".repeat(500))
    expect(m.title).toHaveLength(200)
  })
})
