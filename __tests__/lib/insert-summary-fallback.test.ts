import { insertSummary } from "../../db/summaries"

// Every column on `summaries` beyond user_id and content arrived in a later
// migration. When the code ships ahead of one, the insert is rejected for a
// column the database has never heard of and that turn's memory is gone — not
// degraded, gone, with the chat still working and nothing on screen to say so.
//
// That is not hypothetical. `chat_id` shipped without its migration, and every
// in-app summarise call for three weeks failed exactly this way; it surfaced
// when the assistant was asked about yesterday and had nothing after 19 August.

type Reply = { data: { id: string } | null; error: unknown }

/** Records each insert and answers from a queue of canned replies. */
function mockSupabase(replies: Reply[]) {
  const writes: Record<string, unknown>[] = []

  const client = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          writes.push(row)
          const reply = replies[writes.length - 1]
          return {
            select: () => ({
              single: async () =>
                reply ?? { data: null, error: { message: "no stub" } }
            })
          }
        }
      }
    }
  }

  return { client: client as never, writes }
}

const ok = (id = "row-1"): Reply => ({ data: { id }, error: null })

const CONTENT = "### [2026-09-11] A conversation\nWe talked about indexes."

let warn: jest.SpyInstance

beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe("insertSummary", () => {
  it("writes the typed columns when the database has them", async () => {
    const { client, writes } = mockSupabase([ok()])

    await expect(
      insertSummary(client, "user-1", CONTENT, "chat-1")
    ).resolves.toBe("row-1")

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      user_id: "user-1",
      content: CONTENT,
      chat_id: "chat-1",
      kind: "conversation",
      occurred_at: "2026-09-11T00:00:00Z"
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it("keeps the memory when the schema is behind the code", async () => {
    // PostgREST's own schema cache reports the miss.
    const { client, writes } = mockSupabase([
      {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'chat_id' column of 'summaries'"
        }
      },
      ok("row-2")
    ])

    await expect(
      insertSummary(client, "user-1", CONTENT, "chat-1")
    ).resolves.toBe("row-2")

    // Retried with only the columns the table has always had.
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual({ user_id: "user-1", content: CONTENT })
  })

  it("recognises the failure however PostgREST reports it", async () => {
    for (const error of [
      { code: "42703", message: 'column "chat_id" does not exist' },
      { message: 'column "occurred_at" does not exist' },
      { message: "Could not find the 'kind' column of 'summaries'" }
    ]) {
      const { client, writes } = mockSupabase([{ data: null, error }, ok()])

      await expect(
        insertSummary(client, "user-1", CONTENT, "chat-1")
      ).resolves.toBe("row-1")
      expect(writes).toHaveLength(2)
    }
  })

  it("says which columns the database rejected", async () => {
    // Nobody should have to discover a missing migration by asking the
    // assistant what happened yesterday.
    const { client } = mockSupabase([
      {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'chat_id' column of 'summaries'"
        }
      },
      ok()
    ])

    await insertSummary(client, "user-1", CONTENT, "chat-1")

    const message = warn.mock.calls[0][0] as string
    expect(message).toMatch(/chat_id/)
    expect(message).toMatch(/kind/)
    expect(message).toMatch(/db-push/)
  })

  it("still fails on a constraint violation", async () => {
    // Not schema lag. Writing the row again without its metadata would not fix
    // it and would hide a real defect.
    const { client, writes } = mockSupabase([
      {
        data: null,
        error: {
          code: "23514",
          message: 'new row violates check constraint "summaries_kind_known"'
        }
      }
    ])

    await expect(
      insertSummary(client, "user-1", CONTENT, "chat-1")
    ).rejects.toThrow(/summaries_kind_known/)
    expect(writes).toHaveLength(1)
  })

  it("still fails when the row is refused by RLS", async () => {
    const { client, writes } = mockSupabase([
      {
        data: null,
        error: {
          code: "42501",
          message: "new row violates row-level security policy"
        }
      }
    ])

    await expect(insertSummary(client, "user-1", CONTENT)).rejects.toThrow(
      /row-level security/
    )
    expect(writes).toHaveLength(1)
  })

  it("reports the failure when even the minimal row will not write", async () => {
    const { client } = mockSupabase([
      {
        data: null,
        error: { code: "PGRST204", message: "Could not find the 'kind' column" }
      },
      { data: null, error: { message: "connection terminated" } }
    ])

    await expect(insertSummary(client, "user-1", CONTENT)).rejects.toThrow(
      /connection terminated/
    )
  })
})
