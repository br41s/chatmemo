import {
  extractDateRange,
  extractIsoDate,
  extractQuotedPhrases,
  extractTopicWords
} from "../../lib/server/memory-terms"

// Date parsing was private to a 724-line module and therefore untested. It is
// the part of retrieval most likely to be quietly wrong: it decides which slice
// of history gets searched, and a wrong month silently returns nothing.

describe("extractIsoDate", () => {
  it("finds an ISO date anywhere in the message", () => {
    expect(extractIsoDate("recover the chat from 2025-03-14 please")).toBe(
      "2025-03-14"
    )
  })

  it("returns null when there is none", () => {
    expect(extractIsoDate("the conversation about flights")).toBeNull()
  })
})

describe("extractDateRange", () => {
  it("reads a month and year in either order", () => {
    const a = extractDateRange("the january 2025 conversation")
    const b = extractDateRange("the 2025 january conversation")

    expect(a?.from.toISOString().slice(0, 10)).toBe("2025-01-01")
    expect(a?.to.toISOString().slice(0, 7)).toBe("2025-01")
    expect(b?.from.toISOString().slice(0, 10)).toBe(
      a?.from.toISOString().slice(0, 10)
    )
  })

  it("closes a month range on its own last day", () => {
    // February, so a naive `new Date(year, month, 30)` would overshoot.
    const range = extractDateRange("february 2024 conversation")

    expect(range?.to.getMonth()).toBe(1)
    expect(range?.to.getDate()).toBe(29)
  })

  it("reads a bare year as the whole year", () => {
    const range = extractDateRange("what did we discuss in 2023")

    expect(range?.from.getFullYear()).toBe(2023)
    expect(range?.from.getMonth()).toBe(0)
    expect(range?.to.getMonth()).toBe(11)
    expect(range?.to.getDate()).toBe(31)
  })

  it("takes a bare month name as the most recent one that has happened", () => {
    jest.useFakeTimers().setSystemTime(new Date(2025, 2, 15))

    // March has started, so "march" means this year.
    expect(extractDateRange("the march conversation")?.from.getFullYear()).toBe(
      2025
    )
    // December has not, so it means last year rather than a range in the future.
    expect(
      extractDateRange("the december conversation")?.from.getFullYear()
    ).toBe(2024)

    jest.useRealTimers()
  })

  it("reads relative ranges in both languages", () => {
    jest.useFakeTimers().setSystemTime(new Date(2025, 5, 10, 12, 0, 0))

    const yesterday = extractDateRange("yesterday's chat")
    expect(yesterday?.from.getDate()).toBe(9)
    expect(yesterday?.from.getHours()).toBe(0)
    expect(yesterday?.to.getHours()).toBe(23)

    expect(extractDateRange("la conversación de ayer")?.from.getDate()).toBe(9)
    expect(extractDateRange("last week")?.from.getDate()).toBe(3)
    expect(extractDateRange("la semana pasada")?.from.getDate()).toBe(3)
    expect(extractDateRange("last month")?.from.getMonth()).toBe(4)
    expect(extractDateRange("el mes pasado")?.from.getMonth()).toBe(4)

    jest.useRealTimers()
  })

  it("returns null when the message names no time at all", () => {
    expect(extractDateRange("recover the conversation about phuket")).toBeNull()
  })
})

describe("extractQuotedPhrases", () => {
  it("reads straight and curly quotes alike", () => {
    expect(extractQuotedPhrases('the one called "Flight to Phuket"')).toEqual([
      "Flight to Phuket"
    ])
    expect(extractQuotedPhrases("the one called “Flight to Phuket”")).toEqual([
      "Flight to Phuket"
    ])
  })

  it("keeps only the part before the first comma", () => {
    // The stored title still holds the whole string, and ILIKE matches on the
    // comma-free prefix — a comma in the middle would otherwise never match.
    expect(extractQuotedPhrases('"Flight to Phuket, then Bangkok"')).toEqual([
      "Flight to Phuket"
    ])
  })

  it("ignores fragments too short to identify anything", () => {
    expect(extractQuotedPhrases('the "ok" one')).toEqual([])
  })
})

describe("extractTopicWords", () => {
  it("strips dates, months and filler and caps the result", () => {
    expect(
      extractTopicWords(
        "recover the full conversation about flights to phuket from january 2025"
      )
    ).toEqual(["flights", "phuket"])
  })

  it("drops Spanish filler too", () => {
    expect(
      extractTopicWords("recupera la conversación completa sobre vuelos")
    ).toEqual(["vuelos"])
  })

  it("returns nothing when the message is only filler", () => {
    expect(extractTopicWords("recover the full conversation")).toEqual([])
  })
})
