/**
 * @jest-environment node
 */
import { getLessons } from "../../lib/db/lessons"
import {
  __clearBaselineCache,
  getLatestSummaryForUser
} from "../../lib/server/get-latest-summary"
import { MEMORY_ORDER_COLUMN } from "../../lib/summary-metadata"
import { createClient } from "../../lib/supabase/server"

// Memory is ordered by when a conversation happened, not when its row was
// written. Those are the same thing for a row saved as you talk, and very
// different for a bulk import: an archive loaded today gives hundreds of rows
// today's `created_at` and an `occurred_at` from years ago. Ordering by
// insertion put that archive above everything the user said this week, and
// since the baseline keeps only the newest 150 rows and fits ~100 of them, one
// import could push every recent conversation out of memory — after which the
// model is asked about yesterday and answers that the history stops in August.
//
// `.order()` is not type-checked against the schema in this version of
// supabase-js, so nothing but this file would notice a revert to `created_at`.

jest.mock("../../lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("next/headers", () => ({ cookies: jest.fn(() => ({})) }))
jest.mock("../../lib/db/lessons", () => ({ getLessons: jest.fn() }))

const createClientMock = createClient as unknown as jest.Mock
const getLessonsMock = getLessons as unknown as jest.Mock

const USER = "11111111-1111-4111-8111-111111111111"

interface Recorded {
  table: string
  orderedBy: string | null
  /** The cache-version query is the one asking for an exact count. */
  isVersionQuery: boolean
}

let recorded: Recorded[] = []

function installDb() {
  createClientMock.mockReturnValue({
    from(table: string) {
      const call: Recorded = { table, orderedBy: null, isVersionQuery: false }
      recorded.push(call)

      const builder: Record<string, unknown> = {
        select(_cols: string, opts?: { count?: string }) {
          call.isVersionQuery = opts?.count === "exact"
          return builder
        },
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        not: () => builder,
        order(column: string) {
          call.orderedBy = column
          return builder
        },
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: [{ id: "a", content: "### [2026-09-05] Yesterday" }],
            count: 1,
            error: null
          }).then(resolve)
      }

      return builder
    }
  })
}

beforeEach(() => {
  recorded = []
  __clearBaselineCache()
  installDb()
  getLessonsMock.mockResolvedValue(null)
})

describe("baseline memory ordering", () => {
  it("orders every content query by the conversation's own date", async () => {
    await getLatestSummaryForUser(USER)

    const content = recorded.filter(
      call => call.table === "summaries" && !call.isVersionQuery
    )

    // Personal, bulk and index.
    expect(content).toHaveLength(3)
    for (const call of content) {
      expect(call.orderedBy).toBe(MEMORY_ORDER_COLUMN)
    }
  })

  it("still versions the cache on insertion time", async () => {
    // "Has anything been written since the blob was built" is a question about
    // writes. A row imported today carrying a 2024 date must invalidate the
    // cache, which ordering by the conversation date would not do.
    await getLatestSummaryForUser(USER)

    const version = recorded.find(call => call.isVersionQuery)

    expect(version).toBeDefined()
    expect(version!.orderedBy).toBe("created_at")
  })

  it("names the ordering column once", () => {
    // A typo would compile, deploy, and fail inside memory retrieval — which
    // degrades silently to no memory rather than raising anything.
    expect(MEMORY_ORDER_COLUMN).toBe("effective_at")
  })
})
