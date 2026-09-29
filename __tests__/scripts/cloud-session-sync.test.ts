/**
 * @jest-environment node
 */
import {
  buildPayload,
  parseTranscript,
  shouldSync,
  workerEnv
} from "../../public/hooks/chatmemo-cloud-sync.mjs"

// Cloud sessions never touch the laptop, so the laptop sync never saw them:
// "Search results mixing across users" and "bl-site-cliente vs Shoroban
// features" were worked on the 28th and ChatMemo had no trace of either.

const line = (type: string, content: unknown, timestamp?: string) =>
  JSON.stringify({ type, timestamp, message: { content } })

describe("parseTranscript", () => {
  it("keeps user and assistant text, with when it was said", () => {
    const messages = parseTranscript(
      [
        line("user", "please fix the search results", "2026-09-28T03:50:00Z"),
        line(
          "assistant",
          [
            { type: "text", text: "Looking at the query builder now." },
            { type: "tool_use", name: "Bash" }
          ],
          "2026-09-28T03:51:00Z"
        ),
        line("user", [{ type: "tool_result", content: "ok" }]),
        JSON.stringify({ type: "summary", summary: "ignored" }),
        "not json"
      ].join("\n")
    )

    expect(messages).toEqual([
      {
        role: "user",
        text: "please fix the search results",
        at: "2026-09-28T03:50:00Z"
      },
      {
        role: "assistant",
        text: "Looking at the query builder now.",
        at: "2026-09-28T03:51:00Z"
      }
    ])
  })
})

describe("shouldSync", () => {
  it("posts from three user messages, then every five more", () => {
    expect(shouldSync(undefined, 2, false)).toBe(false)
    expect(shouldSync(undefined, 3, false)).toBe(true)
    expect(shouldSync(3, 7, false)).toBe(false)
    expect(shouldSync(3, 8, false)).toBe(true)
  })

  it("posts any growth when the session ends", () => {
    expect(shouldSync(8, 9, true)).toBe(true)
    expect(shouldSync(8, 8, true)).toBe(false)
  })
})

describe("buildPayload", () => {
  const messages = [
    { role: "user", text: "first", at: "2026-09-27T23:00:00Z" },
    { role: "assistant", text: "answer", at: "2026-09-28T04:52:00Z" }
  ]

  it("keys the post by session so ChatMemo replaces the previous one", () => {
    const payload = buildPayload({
      sessionId: "abc-123",
      cwd: "/home/user/bl-site-cliente",
      messages
    })

    expect(payload).toMatchObject({
      title: "[Claude Code cloud] bl-site-cliente",
      date: "2026-09-28",
      sessionKey: "claude-code:abc-123"
    })
    expect(payload.sessionKey).toMatch(/^[\w:.-]{1,200}$/)
  })

  it("keeps the most recent messages when the session is too long to send", () => {
    const long = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `${i} `.padEnd(3_000, "x")
    }))

    const { messages: sent } = buildPayload({
      sessionId: "s",
      cwd: "/w/p",
      messages: long
    })
    const total = sent.reduce(
      (n: number, m: { text: string }) => n + m.text.length,
      0
    )

    expect(total).toBeLessThanOrEqual(80_000)
    expect(sent[sent.length - 1].text.startsWith("59 ")).toBe(true)
    expect(sent[0].text.startsWith("0 ")).toBe(false)
  })
})

describe("workerEnv", () => {
  // Node's fetch ignores HTTPS_PROXY on its own; in a cloud container every
  // post then went out directly and was refused as "Host not in allowlist".
  it("routes the worker's fetch through the container's proxy", () => {
    expect(
      workerEnv({ HTTPS_PROXY: "http://127.0.0.1:3128" }).NODE_USE_ENV_PROXY
    ).toBe("1")
    expect(
      workerEnv({ https_proxy: "http://127.0.0.1:3128" }).NODE_USE_ENV_PROXY
    ).toBe("1")
  })

  it("leaves a machine without a proxy alone", () => {
    expect(workerEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin" })
  })
})
