/**
 * @jest-environment node
 *
 * Tests for replaceSessionSummary — one row per Claude Code cloud session.
 *
 * The cloud hook posts a session again as it grows. Without replacement every
 * post would add a row, and a long session would fill the memory block with
 * near-identical summaries of itself.
 */
import { replaceSessionSummary } from "../../db/summaries"
import type { SupabaseClient } from "@supabase/supabase-js"

const USER = "11111111-1111-4111-8111-111111111111"
const KEY = "claude-code:0c794a0f-ecce-5ef9-9cb6-c8d8399ca004"

interface Recorded {
  order: string[]
  inserted?: Record<string, unknown>
  deleteFilters: Record<string, unknown>
  deleteNeq?: [string, unknown]
}

function fakeSupabase(options: {
  insertedId?: string
  insertError?: unknown
  deleteError?: unknown
}) {
  const recorded: Recorded = { order: [], deleteFilters: {} }

  const client = {
    from() {
      const builder: Record<string, unknown> = {
        insert(values: Record<string, unknown>) {
          recorded.order.push("insert")
          recorded.inserted = values
          return builder
        },
        select() {
          return builder
        },
        single() {
          return Promise.resolve({
            data: { id: options.insertedId ?? "new-row" },
            error: options.insertError ?? null
          })
        },
        delete() {
          recorded.order.push("delete")
          return builder
        },
        eq(column: string, value: unknown) {
          recorded.deleteFilters[column] = value
          return builder
        },
        neq(column: string, value: unknown) {
          recorded.deleteNeq = [column, value]
          return Promise.resolve({ error: options.deleteError ?? null })
        }
      }
      return builder
    }
  }

  return { client: client as unknown as SupabaseClient<any>, recorded }
}

describe("replaceSessionSummary", () => {
  it("stores the summary under the session's key", async () => {
    const { client, recorded } = fakeSupabase({})

    await replaceSessionSummary(client, USER, KEY, "### [2026-09-28] work")

    expect(recorded.inserted).toMatchObject({
      user_id: USER,
      external_id: KEY,
      content: "### [2026-09-28] work"
    })
    expect(recorded.inserted).not.toHaveProperty("chat_id")
  })

  it("prunes only this user's other rows for the same session, after the insert", async () => {
    const { client, recorded } = fakeSupabase({ insertedId: "row-9" })

    await replaceSessionSummary(client, USER, KEY, "summary")

    expect(recorded.order).toEqual(["insert", "delete"])
    expect(recorded.deleteFilters).toMatchObject({
      user_id: USER,
      external_id: KEY
    })
    expect(recorded.deleteNeq).toEqual(["id", "row-9"])
  })

  it("keeps the new row when the prune fails", async () => {
    // e.g. the external_id migration is not applied yet.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const { client } = fakeSupabase({
      deleteError: { message: "column summaries.external_id does not exist" }
    })

    await expect(
      replaceSessionSummary(client, USER, KEY, "summary")
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
