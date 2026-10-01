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
import {
  classifySummaryContent,
  restoredSource,
  storedSummary
} from "@/lib/summary-metadata"

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
      expect([
        "claude",
        "claude_code",
        "copilot",
        "chatgpt",
        "perplexity",
        "other"
      ]).toContain(m.source)
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

describe("classifySummaryContent — bracketless date headers", () => {
  // The Claude Code Stop hook asked its summariser for `### [date] Title` and
  // mostly got `### date Title`. Mirrored by the trigger in
  // 20260929000000_summaries_bracketless_dates.sql and pinned there by
  // `__tests__/migrations/summaries-bracketless-dates.integration.sql`; the
  // source became `claude_code` in 20261001000000_summaries_claude_code_source.sql.
  it("reads the date, title and source of an untagged session row", () => {
    expect(
      classifySummaryContent(
        "### 2026-09-23 FinView Audit\n\n- **Project:** FinView"
      )
    ).toEqual({
      source: "claude_code",
      kind: "conversation",
      title: "FinView Audit",
      occurredAt: "2026-09-23"
    })
  })

  it("keeps a tag's source", () => {
    expect(
      classifySummaryContent("[source:chatgpt]\n### 2025-11-05 Tax questions")
    ).toMatchObject({
      source: "chatgpt",
      title: "Tax questions",
      occurredAt: "2025-11-05"
    })
  })

  it("does not read a timestamp as a header date", () => {
    expect(classifySummaryContent("### 2026-09-27T10:00 notes")).toMatchObject({
      source: "other",
      occurredAt: null
    })
  })
})

describe("Claude Code as its own source", () => {
  // Mirrored by the trigger in 20261001000000_summaries_claude_code_source.sql
  // and pinned there by
  // `__tests__/migrations/summaries-claude-code-source.integration.sql`.
  it("reads the tag the session scripts write", () => {
    expect(
      classifySummaryContent(
        "[source:claude_code]\n### [2026-10-01] chatmemo\n\n- shipped"
      )
    ).toEqual({
      source: "claude_code",
      kind: "conversation",
      title: "chatmemo",
      occurredAt: "2026-10-01"
    })
  })

  it("leaves a Claude.ai row as claude", () => {
    expect(
      classifySummaryContent("[source:claude]\n### [2026-03-01] Qatar flight")
        .source
    ).toBe("claude")
    expect(
      classifySummaryContent("### [2024-12-24] Christmas planning").source
    ).toBe("claude")
  })

  it("goes by the first header when a row has both forms", () => {
    expect(
      classifySummaryContent("### [2026-05-01] First\n\n### 2026-05-02 Second")
        .source
    ).toBe("claude")
  })
})

describe("storedSummary", () => {
  it("tags a cloud session's summary", () => {
    expect(
      storedSummary(
        "### [2026-10-01] FlyWell redesign\n- done",
        "claude-code:abc"
      )
    ).toBe("[source:claude_code]\n### [2026-10-01] FlyWell redesign\n- done")
  })

  it("leaves a bookmarklet save untagged", () => {
    const text = "### [2026-10-01] Trip notes\n- flights"
    expect(storedSummary(text, null)).toBe(text)
    expect(storedSummary(text, "other-writer:1")).toBe(text)
  })

  it("puts back the brackets the summariser dropped", () => {
    const stored = storedSummary("### 2026-10-01 Trip notes\n- flights", null)
    expect(stored).toBe("### [2026-10-01] Trip notes\n- flights")
    // So a Claude.ai save is never taken for an old Stop hook row.
    expect(classifySummaryContent(stored).source).toBe("claude")
  })

  it("does not bracket a timestamp", () => {
    const text = "### 2026-10-01T10:00 notes"
    expect(storedSummary(text, null)).toBe(text)
  })
})

describe("restoredSource", () => {
  it("keeps the file's word for a session whose content says claude", () => {
    expect(restoredSource("claude", "claude_code")).toBe("claude_code")
  })

  it("takes nothing else from the file", () => {
    expect(restoredSource("chatgpt", "claude_code")).toBe("chatgpt")
    expect(restoredSource("other", "claude_code")).toBe("other")
    expect(restoredSource("claude", "perplexity")).toBe("claude")
    expect(restoredSource("claude", undefined)).toBe("claude")
    expect(restoredSource("claude", { evil: true })).toBe("claude")
  })
})

describe("Copilot as its own source", () => {
  // Mirrored by the trigger in 20261002000000_summaries_copilot_source.sql
  // and pinned there by
  // `__tests__/migrations/summaries-copilot-source.integration.sql`.
  const source = (content: string) => classifySummaryContent(content).source

  it("reads the tag the sync writes", () => {
    expect(
      source("[source:copilot]\n### [2026-10-01] VSCODE [Copilot]\n\n- shipped")
    ).toBe("copilot")
  })

  it("reads the title marker of a row synced before the tag", () => {
    expect(source("### [2026-09-12] OptionsAI [Copilot]\n\n- fix")).toBe(
      "copilot"
    )
    // Over the bare-date rule that would make it a Claude Code session.
    expect(source("### 2026-09-12 OptionsAI [Copilot]\n\n- fix")).toBe(
      "copilot"
    )
  })

  it("only goes by the end of the first header's title", () => {
    expect(source("### [2026-05-22] [Copilot] importer and watcher")).toBe(
      "claude"
    )
    expect(
      source("### [2026-05-22] Session importer\n- handles [Copilot]")
    ).toBe("claude")
    expect(
      source("### [2026-05-01] First\n\n### [2026-05-02] Second [Copilot]")
    ).toBe("claude")
  })

  it("keeps a tag's source", () => {
    expect(
      source("[source:chatgpt]\n### [2025-11-05] Notes on [Copilot]")
    ).toBe("chatgpt")
  })
})
