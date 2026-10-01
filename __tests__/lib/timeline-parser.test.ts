import { parseSummariesToEntries } from "@/lib/timeline-parser"

// The Claude Code Stop hook's summariser wrote `### 2026-09-27 Title` without
// the brackets. Unrecognised, each such row landed in the timeline under the
// day it was written, titled with its own date.

describe("parseSummariesToEntries — date headers", () => {
  it("reads a bracketless header like a bracketed one", () => {
    const [bare] = parseSummariesToEntries([
      {
        id: "a",
        content: "### 2026-09-27 Repurpose Agents\n- moved the directory",
        created_at: "2026-09-29T08:00:00Z"
      }
    ])
    const [bracketed] = parseSummariesToEntries([
      {
        id: "b",
        content: "### [2026-09-27] Repurpose Agents\n- moved the directory",
        created_at: "2026-09-29T08:00:00Z"
      }
    ])

    expect(bare.date).toBe("2026-09-27")
    expect(bare.title).toBe("Repurpose Agents")
    expect({ date: bare.date, title: bare.title }).toEqual({
      date: bracketed.date,
      title: bracketed.title
    })
  })
})

describe("parseSummariesToEntries — Claude Code sessions", () => {
  const row = (content: string, source?: string | null) => ({
    id: "a",
    content,
    created_at: "2026-10-01T08:00:00Z",
    source
  })

  it("reads the session scripts' tag", () => {
    const [entry] = parseSummariesToEntries([
      row("[source:claude_code]\n### [2026-10-01] chatmemo\n- shipped")
    ])
    expect(entry.source).toBe("claude-code")
    expect(entry.title).toBe("chatmemo")
  })

  it("takes the stored source over the tag, for sessions synced as claude", () => {
    const [entry] = parseSummariesToEntries([
      row("[source:claude]\n### [2026-09-29] biglobster\n- fix", "claude_code")
    ])
    expect(entry.source).toBe("claude-code")
  })

  it("leaves a Claude import as it was", () => {
    const [entry] = parseSummariesToEntries([
      row("[source:claude]\n### [2026-03-01] Qatar flight\n- rebook", "claude")
    ])
    expect(entry.source).toBe("import")
  })
})
