/**
 * @jest-environment node
 *
 * Tests for replaceLessons — the conditional write that ended the
 * last-write-wins race on the lessons document.
 *
 * Two chats finishing at once both read the same document, both rewrite it
 * from their own conversation, and the blind upsert this replaces let the
 * second write silently discard the first's facts.
 */
import { replaceLessons } from "@/lib/db/lessons"
import type { SupabaseClient } from "@supabase/supabase-js"

const USER = "11111111-1111-4111-8111-111111111111"
const SEEN = "2026-08-01T10:00:00Z"

interface Recorded {
  table?: string
  op?: "insert" | "update"
  values?: Record<string, unknown>
  filters: Record<string, unknown>
}

/** Minimal stand-in that records the query it was asked to run and returns a
 *  configured outcome. */
function fakeSupabase(outcome: {
  updatedRows?: { user_id: string }[]
  error?: unknown
}) {
  const recorded: Recorded = { filters: {} }

  const builder: Record<string, unknown> = {
    insert(values: Record<string, unknown>) {
      recorded.op = "insert"
      recorded.values = values
      return Promise.resolve({ error: outcome.error ?? null })
    },
    update(values: Record<string, unknown>) {
      recorded.op = "update"
      recorded.values = values
      return builder
    },
    eq(column: string, value: unknown) {
      recorded.filters[column] = value
      return builder
    },
    select() {
      return Promise.resolve({
        data: outcome.updatedRows ?? [],
        error: outcome.error ?? null
      })
    }
  }

  const client = {
    from(table: string) {
      recorded.table = table
      return builder
    }
  }

  return { client: client as unknown as SupabaseClient, recorded }
}

describe("replaceLessons — conditional update", () => {
  it("writes when the document is still at the version that was read", async () => {
    const { client, recorded } = fakeSupabase({
      updatedRows: [{ user_id: USER }]
    })

    const won = await replaceLessons(client, USER, "new document", SEEN)

    expect(won).toBe(true)
    expect(recorded.op).toBe("update")
    // The version stamp seen at read time is part of the predicate — that is
    // the whole mechanism.
    expect(recorded.filters).toMatchObject({
      user_id: USER,
      updated_at: SEEN
    })
  })

  it("reports a loss when another writer moved the document first", async () => {
    // The conditional update matches no row, so nothing was overwritten.
    const { client } = fakeSupabase({ updatedRows: [] })

    const won = await replaceLessons(client, USER, "new document", SEEN)

    expect(won).toBe(false)
  })

  it("reports a loss when the update errored", async () => {
    const { client } = fakeSupabase({
      updatedRows: [{ user_id: USER }],
      error: { message: "boom" }
    })

    expect(await replaceLessons(client, USER, "doc", SEEN)).toBe(false)
  })

  it("stamps a fresh updated_at so the next writer's read is the new version", async () => {
    const { client, recorded } = fakeSupabase({
      updatedRows: [{ user_id: USER }]
    })

    await replaceLessons(client, USER, "new document", SEEN)

    expect(recorded.values).toHaveProperty("content", "new document")
    expect(recorded.values?.updated_at).not.toBe(SEEN)
  })
})

describe("replaceLessons — first write", () => {
  it("inserts when no document was seen at read time", async () => {
    const { client, recorded } = fakeSupabase({})

    const won = await replaceLessons(client, USER, "first document", null)

    expect(won).toBe(true)
    expect(recorded.op).toBe("insert")
    expect(recorded.values).toMatchObject({
      user_id: USER,
      content: "first document"
    })
  })

  it("reports a loss when another writer created the row first", async () => {
    // The unique constraint on user_id rejects the second insert, which is
    // exactly the signal that someone else won.
    const { client } = fakeSupabase({
      error: { message: "duplicate key value violates unique constraint" }
    })

    expect(await replaceLessons(client, USER, "first document", null)).toBe(
      false
    )
  })
})
