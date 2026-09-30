/**
 * @jest-environment node
 *
 * Tests for lib/memory-stats.ts — what the empty chat screen says about the
 * memory behind it.
 */
import { describeNewest, memoryConstellation } from "@/lib/memory-stats"

describe("memoryConstellation", () => {
  it("lists the sources that have rows, largest first, sized by share", () => {
    const chips = memoryConstellation({
      total: 200,
      bySource: { claude: 50, chatgpt: 120, perplexity: 0, other: 30 },
      newest: "2026-09-29"
    })
    expect(chips.map(chip => [chip.label, chip.count])).toEqual([
      ["ChatGPT", 120],
      ["Claude", 50],
      ["Chat", 30]
    ])
    expect(chips[0].share).toBeCloseTo(0.6)
    expect(chips[0].key).toBe("chatgpt")
  })

  it("shares are against the total, so an uncounted row shrinks the chips", () => {
    const [chip] = memoryConstellation({
      total: 10,
      bySource: { chatgpt: 5 },
      newest: null
    })
    expect(chip.share).toBe(0.5)
  })

  it("is empty when there is nothing", () => {
    expect(
      memoryConstellation({ total: 0, bySource: {}, newest: null })
    ).toEqual([])
  })
})

describe("describeNewest", () => {
  const now = new Date(2026, 8, 30, 9, 0) // 30 Sep 2026, local time

  it("says today, yesterday and days ago by calendar day", () => {
    expect(describeNewest("2026-09-30", now)).toBe("today")
    expect(describeNewest("2026-09-29", now)).toBe("yesterday")
    expect(describeNewest("2026-09-25", now)).toBe("5 days ago")
  })

  it("falls back to a short date past a month", () => {
    expect(describeNewest("2026-07-04", now)).toMatch(/4 Jul|Jul 4/)
    expect(describeNewest("2025-07-04", now)).toMatch(/2025/)
  })

  it("places an instant on the viewer's own calendar", () => {
    // A row with no conversation date reports when it was written. Built
    // from local components so the test holds in any timezone: late last
    // night is yesterday, and early this morning is today even where that
    // instant is still the previous day in UTC.
    const lastNight = new Date(2026, 8, 29, 23, 10).toISOString()
    const thisMorning = new Date(2026, 8, 30, 0, 30).toISOString()
    expect(describeNewest(lastNight, now)).toBe("yesterday")
    expect(describeNewest(thisMorning, now)).toBe("today")
  })

  it("rejects what it cannot read", () => {
    expect(describeNewest(null, now)).toBeNull()
    expect(describeNewest("soon", now)).toBeNull()
  })
})
