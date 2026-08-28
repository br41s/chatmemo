import { CHAT_PAGE_SIZE, getMessagesByChatId } from "../../db/messages"
import { supabase } from "../../lib/supabase/browser-client"

jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: { from: jest.fn() }
}))

const fromMock = (supabase as unknown as { from: jest.Mock }).from

/** Records the query the code builds, and answers with `rows`. */
function mockQuery(rows: unknown[], error: unknown = null) {
  const calls: Record<string, unknown[]> = {}
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args
      return builder
    }

  const builder: any = {
    select: record("select"),
    eq: record("eq"),
    order: record("order"),
    lt: record("lt"),
    limit: record("limit")
  }

  // The real builder keeps returning itself and is thenable, which is what lets
  // `.lt()` be applied after `.limit()`.
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: rows, error })

  fromMock.mockReturnValue(builder)
  return calls
}

const row = (sequence: number) => ({
  id: `m${sequence}`,
  sequence_number: sequence,
  image_paths: [],
  file_items: []
})

beforeEach(() => jest.clearAllMocks())

describe("getMessagesByChatId", () => {
  it("asks for the newest page and hands it back oldest first", async () => {
    // Newest-first is how the limit lands on the recent end; the transcript
    // reads the other way.
    const calls = mockQuery([row(3), row(2), row(1)])

    const { messages } = await getMessagesByChatId("chat-1")

    expect(calls.order).toEqual(["sequence_number", { ascending: false }])
    expect(messages.map(m => m.sequence_number)).toEqual([1, 2, 3])
  })

  it("embeds the file items rather than fetching them per message", async () => {
    // The N+1 this replaces: one query per message, before anything rendered.
    const calls = mockQuery([row(1)])

    await getMessagesByChatId("chat-1")

    expect(calls.select).toEqual(["*, file_items(*)"])
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it("detects more history from one extra row, not a count query", async () => {
    const calls = mockQuery(
      Array.from({ length: CHAT_PAGE_SIZE + 1 }, (_, i) => row(i))
    )

    const { messages, hasOlder } = await getMessagesByChatId("chat-1")

    expect(calls.limit).toEqual([CHAT_PAGE_SIZE + 1])
    expect(hasOlder).toBe(true)
    expect(messages).toHaveLength(CHAT_PAGE_SIZE)
  })

  it("reports no more history when the page is not full", async () => {
    mockQuery([row(2), row(1)])

    const { messages, hasOlder } = await getMessagesByChatId("chat-1")

    expect(hasOlder).toBe(false)
    expect(messages).toHaveLength(2)
  })

  it("walks backwards from a sequence number", async () => {
    const calls = mockQuery([row(1)])

    await getMessagesByChatId("chat-1", { before: 42 })

    expect(calls.lt).toEqual(["sequence_number", 42])
  })

  it("does not filter when starting from the newest", async () => {
    const calls = mockQuery([row(1)])

    await getMessagesByChatId("chat-1")

    expect(calls.lt).toBeUndefined()
  })

  it("throws with the database's reason", async () => {
    mockQuery(null as unknown as unknown[], { message: "permission denied" })

    await expect(getMessagesByChatId("chat-1")).rejects.toThrow(
      "permission denied"
    )
  })
})
