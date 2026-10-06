/**
 * @jest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// The laptop sync used to summarise a session itself and write the row with
// the service-role key — a key that bypasses row security for the whole
// database, kept in a world-readable file and used after every turn. Now it
// posts the session to ChatMemo with the import token, like the cloud hook,
// and holds nothing that reaches the database. It also drops the blocks
// Claude Code injects into user turns and anything shaped like a credential
// before the post.

let home: string
let shared: any
let calls: { method: string; url: string; headers: any; body?: any }[]

function installFetch({
  status = 200,
  inserted = 1,
  reason = undefined as string | undefined
} = {}) {
  calls = []
  global.fetch = jest.fn(async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({
      method: init.method ?? "GET",
      url,
      headers: init.headers,
      body
    })
    if (status !== 200) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid import token" }),
        { status }
      )
    }
    return new Response(JSON.stringify({ success: true, inserted, reason }), {
      status: 200
    })
  }) as unknown as typeof fetch
}

const config = {
  chatmemoUrl: "https://chatmemo.example",
  importToken: "tok-1",
  excludeProjects: ["/Users/x/private"]
}

function transcript(userTurns: number) {
  const messages: { role: string; text: string; at?: string }[] = []
  for (let i = 0; i < userTurns; i++) {
    messages.push({ role: "user", text: `please do step number ${i}` })
    messages.push({ role: "assistant", text: `done with step number ${i}` })
  }
  return messages
}

function sync(userTurns: number, final = false, extra: object = {}) {
  return shared.syncSession({
    config,
    key: "session-a",
    messages: transcript(userTurns),
    mtime: Date.UTC(2026, 8, 28, 15),
    title: "[Claude Code] chatmemo",
    final,
    ...extra
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

describe("readConfig", () => {
  it("refuses a config from before the token-only sync", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ supabaseUrl: "x", serviceRoleKey: "y", userId: "z" })
    )
    expect(shared.readConfig().error).toMatch(/setup:sync/)
  })

  it("refuses a plain-http deployment URL: the token travels in a header", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        chatmemoUrl: "http://chatmemo.example",
        importToken: "t"
      })
    )
    expect(shared.readConfig().error).toMatch(/https/)
  })
})

describe("syncDecision", () => {
  it("waits for three user messages", () => {
    expect(shared.syncDecision(undefined, 2)).toBe("skip")
    expect(shared.syncDecision(undefined, 3)).toBe("sync")
  })

  it("re-syncs a live session only after it has grown enough", () => {
    const entry = { userMessages: 3, mtime: 0, syncedAt: "2026-09-19" }
    expect(shared.syncDecision(entry, 7)).toBe("skip")
    expect(shared.syncDecision(entry, 8)).toBe("sync")
  })

  it("gives an ended session a last sync for any growth", () => {
    const entry = { rowId: "r", userMessages: 8, mtime: 0 }
    expect(shared.syncDecision(entry, 9, { final: true })).toBe("sync")
    expect(shared.syncDecision(entry, 8, { final: true })).toBe("skip")
  })

  it("leaves sessions synced before row ids were recorded", () => {
    // Without the old row's id a second sync would duplicate it.
    expect(shared.syncDecision("2026-09-19T10:00:00.000Z", 40)).toBe("skip")
  })

  it("syncs a session that was once too short and has grown", () => {
    expect(shared.syncDecision("skipped:2026-09-19T10:00:00.000Z", 4)).toBe(
      "sync"
    )
  })
})

describe("activityDate", () => {
  it("falls back to the file's mtime when no message has a timestamp", () => {
    expect(
      shared.activityDate([{ role: "user", text: "x" }], Date.UTC(2026, 8, 20))
    ).toBe("2026-09-20")
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

describe("exclusionReason", () => {
  it("keeps out a project listed in the config, by path and by slug", () => {
    expect(
      shared.exclusionReason(config, { cwd: "/Users/x/private/repo" })
    ).toMatch(/excluded by config/)
    expect(
      shared.exclusionReason(config, { projectSlug: "-Users-x-private-repo" })
    ).toMatch(/excluded by config/)
    expect(
      shared.exclusionReason(config, { cwd: "/Users/x/privateer" })
    ).toBeNull()
    expect(shared.exclusionReason(config, { cwd: "/Users/x/open" })).toBeNull()
  })

  it("keeps out a directory carrying the marker file, and everything below it", () => {
    writeFileSync(join(home, shared.NOSYNC_MARKER), "")
    expect(shared.exclusionReason(config, { cwd: home })).toMatch(/nosync/)
    expect(
      shared.exclusionReason(config, { cwd: join(home, "a", "b") })
    ).toMatch(/nosync/)
  })

  it("maps a path to its slug the way Claude Code does", () => {
    expect(shared.pathToSlug("/Users/x/my_secret.repo/")).toBe(
      "-Users-x-my-secret-repo"
    )
    expect(
      shared.exclusionReason(
        { excludeProjects: ["/Users/x/my_secret.repo"] },
        { projectSlug: "-Users-x-my-secret-repo" }
      )
    ).toMatch(/excluded/)
  })

  it("expands ~ in a configured path", () => {
    expect(
      shared.exclusionReason(
        { excludeProjects: ["~/hidden"] },
        { cwd: join(shared.HOME, "hidden", "x") }
      )
    ).toMatch(/excluded/)
  })
})

describe("transcriptCwd", () => {
  it("reads the working directory the transcript records", () => {
    const file = join(home, "t.jsonl")
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "summary", summary: "x" }),
        JSON.stringify({
          type: "user",
          cwd: "/Users/x/repo",
          message: { content: "hi" }
        })
      ].join("\n")
    )
    expect(shared.transcriptCwd(file)).toBe("/Users/x/repo")
    expect(shared.transcriptCwd(join(home, "missing.jsonl"))).toBeUndefined()
  })
})

describe("parseJSONL", () => {
  it("drops injected blocks and redacts credentials before anything is kept", () => {
    const file = join(home, "t.jsonl")
    const lines = [
      {
        type: "user",
        message: {
          content:
            "<system-reminder>CLAUDE.md says things</system-reminder>please deploy with OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789 and postgres://admin:hunter22@db.example/x"
        },
        timestamp: "2026-09-28T10:00:00Z"
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "<bash-stdout>SECRET=123</bash-stdout>Deployed. The token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c is set"
            }
          ]
        }
      }
    ]
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join("\n"))

    const [user, assistant] = shared.parseJSONL(file)
    expect(user.text).not.toContain("system-reminder")
    expect(user.text).not.toContain("CLAUDE.md")
    expect(user.text).not.toContain("sk-or-v1-")
    expect(user.text).toContain("OPENROUTER_API_KEY=[redacted")
    expect(user.text).toContain("postgres://admin:[redacted]@db.example/x")
    expect(assistant.text).not.toContain("SECRET=123")
    expect(assistant.text).toContain("[redacted jwt]")
    expect(assistant.text).toContain("Deployed.")
  })
})

describe("syncSession", () => {
  it("posts at three turns with the import token, then again as the session grows", async () => {
    expect(await sync(3)).toBe("synced")
    expect(await sync(5)).toBe("skipped")
    expect(await sync(8)).toBe("synced")

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe("https://chatmemo.example/api/import/conversation")
      expect(call.headers.Authorization).toBe("Bearer tok-1")
      expect(call.body.sessionKey).toBe("claude-code:session-a")
      expect(call.body.title).toBe("[Claude Code] chatmemo")
      expect(call.body.replaceRowId).toBeUndefined()
    }
    expect(calls[1].body.messages).toHaveLength(16)

    const sessions = JSON.parse(
      readFileSync(join(home, "imported-sessions.json"), "utf8")
    )
    expect(sessions["session-a"]).toMatchObject({ userMessages: 8 })
    expect(sessions["session-a"].rowId).toBeUndefined()
  })

  it("never sends anything but the token and the cleaned messages", async () => {
    await sync(3)
    expect(Object.keys(calls[0].body).sort()).toEqual([
      "date",
      "messages",
      "sessionKey",
      "title"
    ])
    expect(JSON.stringify(calls[0])).not.toMatch(/service|supabase|openrouter/i)
  })

  it("dates the post by the session's last activity", async () => {
    await sync(3)
    expect(calls[0].body.date).toBe("2026-09-28")
  })

  it("dates the post by its last message, not by when the file was touched", async () => {
    await shared.syncSession({
      config,
      key: "session-b",
      messages: [
        ...transcript(3),
        { role: "user", text: "one more thing", at: "2026-09-27T09:00:00Z" },
        { role: "assistant", text: "done with it", at: "2026-09-28T21:30:00Z" }
      ],
      mtime: Date.UTC(2026, 8, 29, 5),
      title: "[Claude Code] chatmemo"
    })
    expect(calls[0].body.date).toBe("2026-09-28")
  })

  it("asks the server to retire a row the old laptop path wrote, once", async () => {
    writeFileSync(
      join(home, "imported-sessions.json"),
      JSON.stringify({
        "session-a": { rowId: "row-old", userMessages: 3, mtime: 0 }
      })
    )
    expect(await sync(8)).toBe("synced")
    expect(calls[0].body.replaceRowId).toBe("row-old")

    expect(await sync(13)).toBe("synced")
    expect(calls[1].body.replaceRowId).toBeUndefined()
  })

  it("keeps the old row id when the server stored nothing, so it is retired later", async () => {
    writeFileSync(
      join(home, "imported-sessions.json"),
      JSON.stringify({
        "session-a": { rowId: "row-old", userMessages: 3, mtime: 0 }
      })
    )
    installFetch({ inserted: 0, reason: "Nothing worth remembering" })
    expect(await sync(8)).toBe("synced")
    expect(calls[0].body.replaceRowId).toBe("row-old")

    installFetch()
    expect(await sync(13)).toBe("synced")
    expect(calls[0].body.replaceRowId).toBe("row-old")
    const sessions = JSON.parse(
      readFileSync(join(home, "imported-sessions.json"), "utf8")
    )
    expect(sessions["session-a"].rowId).toBeUndefined()
  })

  it("posts Copilot sessions under their own key", async () => {
    await shared.syncSession({
      config,
      key: "copilot:abc",
      messages: transcript(3),
      mtime: 0,
      title: "[Copilot] chatmemo"
    })
    expect(calls[0].body.sessionKey).toBe("copilot:abc")
  })

  it("does not post an excluded project", async () => {
    expect(
      await sync(3, false, { project: { cwd: "/Users/x/private/repo" } })
    ).toBe("excluded")
    expect(calls).toHaveLength(0)
    const log = readFileSync(join(home, "sync.log"), "utf8")
    expect(log).toContain("excluded by config")
  })

  it("records a post the server judged too short, so it is not re-posted every turn", async () => {
    installFetch({ inserted: 0, reason: "Conversation too short to summarize" })
    expect(await sync(3)).toBe("synced")
    expect(await sync(4)).toBe("skipped")
    expect(calls).toHaveLength(1)
  })

  it("logs why a post failed, without the body, and retries next time", async () => {
    installFetch({ status: 401 })

    expect(await sync(3)).toBe("failed")

    const log = readFileSync(join(home, "sync.log"), "utf8")
    expect(log).toContain(
      "session-a: post failed — HTTP 401 Invalid import token"
    )

    installFetch()
    expect(await sync(3)).toBe("synced")
  })
})
