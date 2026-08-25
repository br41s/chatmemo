/**
 * @jest-environment node
 *
 * Tests for replaceChatSummary — one summary row per conversation instead of
 * one per turn.
 *
 * The summarise route fires after every turn, so appending produced roughly
 * nine near-identical rows for a twenty-message chat, restating the same facts
 * into both the table and the injected memory block.
 */
import { replaceChatSummary } from "../../db/summaries"
import type { SupabaseClient } from "@supabase/supabase-js"

const USER = "11111111-1111-4111-8111-111111111111"
const CHAT = "22222222-2222-4222-8222-222222222222"

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

describe("replaceChatSummary", () => {
  it("stores the new summary against the chat", async () => {
    const { client, recorded } = fakeSupabase({})

    await replaceChatSummary(client, USER, CHAT, "what we decided")

    expect(recorded.inserted).toMatchObject({
      user_id: USER,
      chat_id: CHAT,
      content: "what we decided"
    })
  })

  it("inserts before deleting, so a failure never leaves the chat empty", async () => {
    // The other order would delete the only summary and then fail to write the
    // replacement, losing the conversation's memory outright.
    const { client, recorded } = fakeSupabase({})

    await replaceChatSummary(client, USER, CHAT, "what we decided")

    expect(recorded.order).toEqual(["insert", "delete"])
  })

  it("prunes only this chat's older rows, and never the new one", async () => {
    const { client, recorded } = fakeSupabase({ insertedId: "row-new" })

    await replaceChatSummary(client, USER, CHAT, "what we decided")

    expect(recorded.deleteFilters).toMatchObject({
      user_id: USER,
      chat_id: CHAT
    })
    expect(recorded.deleteNeq).toEqual(["id", "row-new"])
  })

  it("still classifies the row, so the memory queries can find it", async () => {
    const { client, recorded } = fakeSupabase({})

    await replaceChatSummary(client, USER, CHAT, "a plain in-app summary")

    // Without kind, the baseline queries filter it straight out.
    expect(recorded.inserted).toMatchObject({ kind: "conversation" })
  })

  it("throws when the insert fails, rather than pruning anyway", async () => {
    const { client, recorded } = fakeSupabase({
      insertError: { message: "insert exploded" }
    })

    await expect(
      replaceChatSummary(client, USER, CHAT, "content")
    ).rejects.toThrow("insert exploded")

    expect(recorded.order).toEqual(["insert"])
  })

  it("keeps the new summary when pruning fails", async () => {
    // A stale sibling costs budget, not correctness, so a failed prune must not
    // fail the write that already succeeded.
    const { client } = fakeSupabase({ deleteError: { message: "prune failed" } })

    await expect(
      replaceChatSummary(client, USER, CHAT, "content")
    ).resolves.toBeUndefined()
  })
})
