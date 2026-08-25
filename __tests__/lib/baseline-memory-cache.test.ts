/**
 * @jest-environment node
 *
 * Tests the caching behaviour of getLatestSummaryForUser.
 *
 * The baseline blob is up to ~100k chars rebuilt from three queries on every
 * chat turn, even though it only changes when the user's memory changes. What
 * has to hold is that the saving never costs correctness: the cache is keyed
 * by a version read from the database, so an entry is either current or
 * missed, never stale.
 */
import {
  __clearBaselineCache,
  getLatestSummaryForUser
} from "../../lib/server/get-latest-summary"
import { getLessons } from "../../lib/db/lessons"
import { createClient } from "../../lib/supabase/server"

jest.mock("../../lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("next/headers", () => ({ cookies: jest.fn(() => ({})) }))
jest.mock("../../lib/db/lessons", () => ({ getLessons: jest.fn() }))

const createClientMock = createClient as unknown as jest.Mock
const getLessonsMock = getLessons as unknown as jest.Mock

const USER = "11111111-1111-4111-8111-111111111111"

interface DbState {
  /** Rows returned to the three content queries. */
  rows: { id: string; content: string }[]
  /** created_at of the newest row, or null when there are none. */
  newest: string | null
  /** Total row count for the user — what makes a deletion visible. */
  count: number
  lessonsUpdatedAt: string | null
  lessons: string | null
}

/** Number of heavy content queries issued since the last reset. */
let heavyQueries = 0

function installDb(state: DbState) {
  createClientMock.mockReturnValue({
    from(table: string) {
      const call: { table: string; count?: boolean } = { table }
      const builder: Record<string, unknown> = {
        select(_cols: string, opts?: { count?: string }) {
          call.count = opts?.count === "exact"
          return builder
        },
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => builder,
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(resultFor()).then(resolve, reject)
        }
      }

      function resultFor() {
        if (call.table === "user_lessons") {
          return {
            data: state.lessonsUpdatedAt
              ? { updated_at: state.lessonsUpdatedAt }
              : null
          }
        }
        // The version probe is the only summaries query asking for a count.
        if (call.count) {
          return {
            data: state.newest ? [{ created_at: state.newest }] : [],
            count: state.count
          }
        }
        heavyQueries++
        return { data: state.rows }
      }

      return builder
    }
  })

  // Lazy, so a test can mutate `state` after installing the database.
  getLessonsMock.mockImplementation(async () => state.lessons)
}

const baseState = (): DbState => ({
  rows: [{ id: "row-1", content: "A remembered thing" }],
  newest: "2026-08-01T10:00:00Z",
  count: 3,
  lessonsUpdatedAt: "2026-08-01T09:00:00Z",
  lessons: "- Ships on Fridays"
})

beforeEach(() => {
  jest.clearAllMocks()
  __clearBaselineCache()
  heavyQueries = 0
})

describe("getLatestSummaryForUser — caching", () => {
  it("builds the blob on a cold cache", async () => {
    installDb(baseState())

    const out = await getLatestSummaryForUser(USER)

    expect(out).toContain("A remembered thing")
    expect(out).toContain("Ships on Fridays")
    expect(heavyQueries).toBe(3)
  })

  it("serves a second identical turn without re-reading the content", async () => {
    installDb(baseState())

    const first = await getLatestSummaryForUser(USER)
    heavyQueries = 0
    const second = await getLatestSummaryForUser(USER)

    expect(second).toEqual(first)
    expect(heavyQueries).toBe(0)
  })

  it("rebuilds when a summary is added", async () => {
    const state = baseState()
    installDb(state)
    await getLatestSummaryForUser(USER)

    state.count = 4
    state.newest = "2026-08-02T10:00:00Z"
    state.rows = [{ id: "row-2", content: "Something newer" }]
    heavyQueries = 0

    const out = await getLatestSummaryForUser(USER)

    expect(out).toContain("Something newer")
    expect(heavyQueries).toBe(3)
  })

  it("rebuilds when an older summary is deleted", async () => {
    // The case a timestamp-only version would miss: deleting an older row from
    // the memory panel leaves the newest row's created_at untouched, so only
    // the count reveals that the content changed.
    const state = baseState()
    installDb(state)
    const before = await getLatestSummaryForUser(USER)
    expect(before).toContain("A remembered thing")

    state.count = 2 // one row deleted; `newest` deliberately unchanged
    state.rows = [{ id: "row-9", content: "What is left" }]
    heavyQueries = 0

    const after = await getLatestSummaryForUser(USER)

    expect(after).toContain("What is left")
    expect(after).not.toContain("A remembered thing")
    expect(heavyQueries).toBe(3)
  })

  it("rebuilds when the lessons document is rewritten", async () => {
    const state = baseState()
    installDb(state)
    await getLatestSummaryForUser(USER)

    state.lessonsUpdatedAt = "2026-08-05T12:00:00Z"
    state.lessons = "- Now prefers long answers"
    heavyQueries = 0

    const out = await getLatestSummaryForUser(USER)

    expect(out).toContain("Now prefers long answers")
    expect(heavyQueries).toBe(3)
  })

  it("caches the empty answer instead of rebuilding it every turn", async () => {
    installDb({
      rows: [],
      newest: null,
      count: 0,
      lessonsUpdatedAt: null,
      lessons: null
    })

    expect(await getLatestSummaryForUser(USER)).toBeNull()
    heavyQueries = 0
    expect(await getLatestSummaryForUser(USER)).toBeNull()
    expect(heavyQueries).toBe(0)
  })

  it("does not serve one user's memory to another", async () => {
    installDb(baseState())
    await getLatestSummaryForUser(USER)
    heavyQueries = 0

    const other = "22222222-2222-4222-8222-222222222222"
    await getLatestSummaryForUser(other)

    expect(heavyQueries).toBe(3)
  })
})
