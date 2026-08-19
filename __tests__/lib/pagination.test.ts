/**
 * Tests for lib/server/pagination.ts — the bounds the summaries routes read
 * their page from. These routes previously selected every row for the user
 * with no limit, so the guarantee under test is that nothing a caller can put
 * in the query string reinstates an unbounded read.
 */
import {
  EXPORT_PAGE,
  HISTORY_PAGE,
  parsePageParams,
  takePage,
  TIMELINE_PAGE
} from "@/lib/server/pagination"

const params = (qs: string) => new URLSearchParams(qs)

describe("parsePageParams", () => {
  it("falls back to the page defaults when nothing is given", () => {
    expect(parsePageParams(params(""), HISTORY_PAGE)).toEqual({
      limit: 50,
      offset: 0
    })
  })

  it("accepts values inside the bounds", () => {
    expect(parsePageParams(params("limit=25&offset=100"), HISTORY_PAGE)).toEqual(
      { limit: 25, offset: 100 }
    )
  })

  it("clamps a limit above the maximum instead of honouring it", () => {
    expect(parsePageParams(params("limit=100000"), HISTORY_PAGE).limit).toBe(
      HISTORY_PAGE.maxLimit
    )
    expect(parsePageParams(params("limit=100000"), TIMELINE_PAGE).limit).toBe(
      TIMELINE_PAGE.maxLimit
    )
    expect(parsePageParams(params("limit=100000"), EXPORT_PAGE).limit).toBe(
      EXPORT_PAGE.maxLimit
    )
  })

  it.each([
    ["limit=0", "zero"],
    ["limit=-1", "negative"],
    ["limit=abc", "non-numeric"],
    ["limit=", "empty"],
    ["limit=NaN", "NaN"],
    ["limit=Infinity", "Infinity"]
  ])("falls back to the default for an unusable limit (%s: %s)", qs => {
    expect(parsePageParams(params(qs), HISTORY_PAGE).limit).toBe(
      HISTORY_PAGE.defaultLimit
    )
  })

  it("truncates a fractional limit rather than passing it through", () => {
    expect(parsePageParams(params("limit=10.9"), HISTORY_PAGE).limit).toBe(10)
  })

  it("falls back to offset 0 for a negative or unusable offset", () => {
    expect(parsePageParams(params("offset=-5"), HISTORY_PAGE).offset).toBe(0)
    expect(parsePageParams(params("offset=abc"), HISTORY_PAGE).offset).toBe(0)
  })
})

describe("takePage", () => {
  it("reports another page when the extra row came back", () => {
    // Routes fetch limit + 1 rows; the extra one is the has-more signal.
    const rows = [1, 2, 3, 4]
    expect(takePage(rows, 3, 0)).toEqual({ page: [1, 2, 3], nextOffset: 3 })
  })

  it("reports the end when the page came back short", () => {
    expect(takePage([1, 2], 3, 0)).toEqual({ page: [1, 2], nextOffset: null })
  })

  it("reports the end when the page came back exactly full", () => {
    // Exactly `limit` rows means the extra one was not there — no more pages.
    expect(takePage([1, 2, 3], 3, 0)).toEqual({
      page: [1, 2, 3],
      nextOffset: null
    })
  })

  it("advances nextOffset from the current offset", () => {
    expect(takePage([1, 2, 3, 4], 3, 60).nextOffset).toBe(63)
  })

  it("handles an empty result", () => {
    expect(takePage([], 50, 0)).toEqual({ page: [], nextOffset: null })
  })
})
