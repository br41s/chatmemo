/**
 * @jest-environment node
 */
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// The laptop sync used to summarise a Claude Code session once, at its third
// user message, and mark it done: the Stop hook fires after every turn, so a
// day's session was remembered by its opening and nothing after it. It also
// logged nothing, so a failing key or summariser left no trace.

let home: string
let shared: any
let calls: { method: string; url: string; body?: any }[]
let nextId: number

function installFetch({ insertStatus = 201 } = {}) {
  calls = []
  nextId = 1
  global.fetch = jest.fn(async (url: string, init: any = {}) => {
    const method = init.method ?? "GET"
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (url.includes("openrouter.ai")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `- Worked on chatmemo sync, summary number ${nextId} of the session`
              }
            }
          ]
        }),
        { status: 200 }
      )
    }
    if (method === "POST") {
      if (insertStatus !== 201) {
        return new Response('{"message":"Invalid API key"}', {
          status: insertStatus
        })
      }
      return new Response(JSON.stringify([{ id: `row-${nextId++}` }]), {
        status: 201
      })
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: "service",
  openrouterKey: "or",
  userId: "user-1"
}

function transcript(userTurns: number) {
  const messages: { role: string; text: string }[] = []
  for (let i = 0; i < userTurns; i++) {
    messages.push({ role: "user", text: `please do step number ${i}` })
    messages.push({ role: "assistant", text: `done with step number ${i}` })
  }
  return messages
}

function sync(userTurns: number, final = false) {
  return shared.syncSession({
    config,
    key: "session-a",
    messages: transcript(userTurns),
    mtime: Date.UTC(2026, 8, 28, 15),
    title: "[Claude Code] chatmemo",
    header: (date: string) => `[source:claude]\n### [${date}] chatmemo`,
    final
  })
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "chatmemo-home-"))
  process.env.CHATMEMO_CONFIG_DIR = home
  jest.resetModules()
  shared = await import("../../scripts/claude-sessions-shared.mjs")
  installFetch()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("syncDecision", () => {
  it("waits for three user messages", () => {
    expect(shared.syncDecision(undefined, 2)).toBe("skip")
    expect(shared.syncDecision(undefined, 3)).toBe("insert")
  })

  it("re-syncs a live session only after it has grown enough", () => {
    const entry = { rowId: "r", userMessages: 3, mtime: 0 }
    expect(shared.syncDecision(entry, 7)).toBe("skip")
    expect(shared.syncDecision(entry, 8)).toBe("replace")
  })

  it("gives an ended session a last sync for any growth", () => {
    const entry = { rowId: "r", userMessages: 8, mtime: 0 }
    expect(shared.syncDecision(entry, 9, { final: true })).toBe("replace")
    expect(shared.syncDecision(entry, 8, { final: true })).toBe("skip")
  })

  it("leaves sessions synced before row ids were recorded", () => {
    // Without the old row's id a second sync would duplicate it.
    expect(shared.syncDecision("2026-09-19T10:00:00.000Z", 40)).toBe("skip")
  })

  it("syncs a session that was once too short and has grown", () => {
    expect(shared.syncDecision("skipped:2026-09-19T10:00:00.000Z", 4)).toBe(
      "insert"
    )
  })
})

describe("hasChangedSince", () => {
  it("re-reads only files modified after they were last seen", () => {
    expect(shared.hasChangedSince(undefined, 5)).toBe(true)
    expect(shared.hasChangedSince({ mtime: 10 }, 5)).toBe(false)
    expect(shared.hasChangedSince({ mtime: 10 }, 11)).toBe(true)
    expect(shared.hasChangedSince("2026-09-19T10:00:00.000Z", 1e15)).toBe(false)
    expect(
      shared.hasChangedSince(
        "skipped:2026-09-19T10:00:00.000Z",
        Date.UTC(2026, 8, 20)
      )
    ).toBe(true)
  })
})

describe("syncSession", () => {
  it("inserts at three turns, then replaces its own row as the session grows", async () => {
    expect(await sync(3)).toBe("inserted")
    expect(await sync(5)).toBe("skipped")
    expect(await sync(8)).toBe("replaced")

    const writes = calls.filter(c => !c.url.includes("openrouter"))
    expect(writes.map(c => c.method)).toEqual(["POST", "POST", "DELETE"])
    // The delete targets the first row, and only after the second exists.
    expect(writes[2].url).toContain("id=eq.row-1")
    expect(writes[2].url).toContain("user_id=eq.user-1")

    const sessions = JSON.parse(
      readFileSync(join(home, "imported-sessions.json"), "utf8")
    )
    expect(sessions["session-a"]).toMatchObject({
      rowId: "row-2",
      userMessages: 8
    })
  })

  it("dates the row by the session's last activity", async () => {
    await sync(3)
    const insert = calls.find(
      c => c.method === "POST" && !c.url.includes("openrouter")
    )
    expect(insert?.body.content).toMatch(
      /^\[source:claude\]\n### \[2026-09-28\] chatmemo\n\n- Worked on/
    )
  })

  it("logs why an insert failed and retries next time", async () => {
    installFetch({ insertStatus: 401 })

    expect(await sync(3)).toBe("failed")

    const log = readFileSync(join(home, "sync.log"), "utf8")
    expect(log).toContain("session-a: insert failed — HTTP 401")
    expect(log).toContain("Invalid API key")

    installFetch()
    expect(await sync(3)).toBe("inserted")
  })
})
