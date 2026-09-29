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
