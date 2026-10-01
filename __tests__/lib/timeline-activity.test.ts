/**
 * @jest-environment node
 *
 * Tests for lib/timeline-activity.ts — the timeline's month-by-month shape.
 */
import {
  activityByMonth,
  monthBounds,
  monthLabel
} from "@/lib/timeline-activity"

describe("activityByMonth", () => {
  it("counts rows by month and source, oldest month first", () => {
    const months = activityByMonth([
      { effective_at: "2026-09-30T10:00:00+00:00", source: "claude" },
      { effective_at: "2026-09-02T00:00:00+00:00", source: "chatgpt" },
      { effective_at: "2026-07-14T00:00:00+00:00", source: "perplexity" },
      { effective_at: "2026-09-12T00:00:00+00:00", source: "claude" },
      { effective_at: "2026-09-13T00:00:00+00:00", source: "claude_code" }
    ])
    expect(months.map(m => m.month)).toEqual(["2026-07", "2026-08", "2026-09"])
    expect(months[2].counts).toEqual({
      claude: 2,
      claude_code: 1,
      copilot: 0,
      chatgpt: 1,
      perplexity: 0,
      other: 0
    })
    expect(months[2].total).toBe(4)
  })

  it("keeps a quiet month as a gap, not a missing bar", () => {
    const months = activityByMonth([
      { effective_at: "2025-12-01", source: "claude" },
      { effective_at: "2026-02-01", source: "claude" }
    ])
    expect(months.map(m => m.month)).toEqual(["2025-12", "2026-01", "2026-02"])
    expect(months[1].total).toBe(0)
  })

  it("puts an unknown source under other and drops an undated row", () => {
    const months = activityByMonth([
      { effective_at: "2026-01-05", source: null },
      { effective_at: "2026-01-06", source: "gemini" },
      { effective_at: null, source: "claude" },
      { effective_at: "soon", source: "claude" }
    ])
    expect(months).toHaveLength(1)
    expect(months[0].counts.other).toBe(2)
    expect(months[0].total).toBe(2)
  })

  it("is empty for no rows", () => {
    expect(activityByMonth([])).toEqual([])
  })
})

describe("monthBounds", () => {
  it("spans the whole month, February included", () => {
    expect(monthBounds("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28"
    })
    expect(monthBounds("2028-02").to).toBe("2028-02-29")
    expect(monthBounds("2026-12").to).toBe("2026-12-31")
  })
})

describe("monthLabel", () => {
  it("names the month and year", () => {
    expect(monthLabel("2026-09", "en-US")).toBe("Sep 2026")
  })
})
