/**
 * @jest-environment node
 */
import { getFullConversationForUser } from "../../lib/server/get-full-conversation"
import { MEMORY_ORDER_COLUMN } from "../../lib/summary-metadata"
import { createClient } from "../../lib/supabase/server"

// "conversaciones de ayer" answered that nothing was stored. The in-app half of
// recall ordered `chats` by `effective_at`, a column only `summaries` has, so
// every chat query failed and its error was dropped with the data. And in-app
// summaries carry no `### [date]` header, so nothing found them by date either.
//
// `.order()` and `.gte()` are not type-checked against the schema in this
// version of supabase-js; this file is what notices a column on the wrong
// table.

jest.mock("../../lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("next/headers", () => ({ cookies: jest.fn(() => ({})) }))

const createClientMock = createClient as unknown as jest.Mock

const USER = "11111111-1111-4111-8111-111111111111"

const COLUMNS: Record<string, string[]> = {
  chats: ["id", "name", "created_at", "user_id"],
  summaries: ["id", "content", "created_at", "effective_at", "user_id", "kind"],
  messages: ["role", "content", "sequence_number", "chat_id"]
}

interface Call {
  table: string
  columns: string[]
  ors: string[]
}

let calls: Call[] = []
let rows: Record<string, unknown[]> = {}

function installDb() {
  createClientMock.mockReturnValue({
    from(table: string) {
      const call: Call = { table, columns: [], ors: [] }
      calls.push(call)
      const record = (column: string) => {
        call.columns.push(column)
        return builder
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (c: string) => record(c),
        in: (c: string) => record(c),
        ilike: (c: string) => record(c),
        gte: (c: string) => record(c),
        lte: (c: string) => record(c),
        order: (c: string) => record(c),
        or: (filter: string) => {
          call.ors.push(filter)
          return builder
        },
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) => {
          const unknown = call.columns.find(c => !COLUMNS[table].includes(c))
          // What PostgREST does with a column the table lacks.
          const result = unknown
            ? { data: null, error: { code: "42703", message: unknown } }
            : {
                data: call.ors.length > 0 ? [] : rows[table] ?? [],
                error: null
              }
          return Promise.resolve(result).then(resolve)
        }
      }
      return builder
    }
  })
}

beforeEach(() => {
  calls = []
  rows = {
    chats: [
      { id: "c1", name: "Trip to Lisbon", created_at: "2026-09-28T18:00:00Z" }
    ],
    messages: [
      { role: "user", content: "Book the Lisbon flight", sequence_number: 0 }
    ],
    summaries: [
      {
        id: "s1",
        content: "User booked a Lisbon flight.",
        created_at: "2026-09-28T18:05:00Z"
      }
    ]
  }
  installDb()
  jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 8, 29, 2, 50)))
  jest.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("recall of a named day", () => {
  it("queries chats only by columns chats has", async () => {
    await getFullConversationForUser(USER, "conversaciones de ayer")

    const chatCalls = calls.filter(c => c.table === "chats")
    expect(chatCalls.length).toBeGreaterThan(0)
    for (const call of chatCalls) {
      for (const column of call.columns) {
        expect(COLUMNS.chats).toContain(column)
      }
    }
  })

  it("returns yesterday's in-app chat and its summary", async () => {
    const out = await getFullConversationForUser(USER, "conversaciones de ayer")

    expect(out).toContain('--- Chat: "Trip to Lisbon"')
    expect(out).toContain("Book the Lisbon flight")
    expect(out).toContain("User booked a Lisbon flight.")
  })

  it("finds summaries of that day by their date, not their text", async () => {
    await getFullConversationForUser(USER, "conversaciones de ayer")

    const byDate = calls.find(
      c => c.table === "summaries" && c.columns.includes("effective_at")
    )
    expect(byDate?.columns.filter(c => c === MEMORY_ORDER_COLUMN)).toHaveLength(
      3 // gte, lte, order
    )
    // No loose text search: the message names a day and nothing else.
    expect(
      calls.some(c => c.table === "summaries" && c.columns.includes("content"))
    ).toBe(false)
  })

  it("keeps the day's chats when the topic is not in their names", async () => {
    const out = await getFullConversationForUser(
      USER,
      "recupera la conversación de ayer sobre vuelos"
    )

    // The topic query matches nothing (names are opening words only); the
    // date-only fallback still returns the chat.
    expect(calls.filter(c => c.table === "chats")).toHaveLength(2)
    expect(out).toContain('--- Chat: "Trip to Lisbon"')
  })
})
