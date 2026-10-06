/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  cleanText,
  nosyncMarkerDir,
  redact,
  stripInjectedBlocks,
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

describe("cleanText", () => {
  it("drops the blocks Claude Code injects into a user turn", () => {
    const text =
      "<system-reminder>\nCLAUDE.md contents\n</system-reminder>\nfix the build\n<local-command-stdout>secret output</local-command-stdout>"
    expect(cleanText(text)).toBe("fix the build")
    expect(cleanText("tail\n<bash-stdout>never closed")).toBe("tail")
  })

  it("replaces anything shaped like a credential, keeping the name", () => {
    const text = [
      "set OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnopqrstuvwxyz012345",
      "aws AKIAIOSFODNN7EXAMPLE",
      "gh ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "db postgres://me:pa55word@host/db",
      'password: "correct-horse-battery-staple"',
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"
    ].join("\n")
    const out = cleanText(text)
    expect(out).toContain("OPENROUTER_API_KEY=[redacted")
    expect(out).not.toContain("sk-or-v1")
    expect(out).toContain("[redacted aws key]")
    expect(out).toContain("[redacted github token]")
    expect(out).toContain("postgres://me:[redacted]@host/db")
    expect(redact("postgres://u:p@ss@host/db x")).toBe(
      "postgres://u:[redacted]@host/db x"
    )
    expect(out).toContain('password: "[redacted]')
    expect(out).toContain("[redacted jwt]")
    expect(out).toContain("[redacted private key]")
    expect(out).not.toContain("MIIE")
  })

  it("leaves ordinary text alone", () => {
    const text =
      "max_tokens: 700 and the token budget is 8k; the password field is required"
    expect(cleanText(text)).toBe(text)
  })
})

describe("parseTranscript cleaning", () => {
  it("cleans every message before it is kept", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content:
          "<system-reminder>x</system-reminder>deploy with ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz"
      }
    })
    const [m] = parseTranscript(jsonl)
    expect(m.text).toBe("deploy with ANTHROPIC_API_KEY=[redacted token]")
  })
})

describe("stripInjectedBlocks", () => {
  it("drops only blocks that start a line, so a tag named in prose stays", () => {
    const prose =
      "Why does the hook drop <system-reminder> blocks? The `<bash-stdout>` tag too."
    expect(stripInjectedBlocks(prose)).toBe(prose)
    expect(
      stripInjectedBlocks(
        "fix it\n<system-reminder>\ninjected\n</system-reminder>\nplease"
      )
    ).toBe("fix it\n\nplease")
    expect(stripInjectedBlocks("tail\n<bash-stdout>never closed")).toBe(
      "tail\n"
    )
    expect(
      stripInjectedBlocks("<System-Reminder>x</System-Reminder>done")
    ).toBe("done")
  })
})

describe("redact: shapes and false positives", () => {
  it("catches bearer headers, JSON keys, query strings and more token shapes", () => {
    const text = [
      'curl -H "Authorization: Bearer 0123456789abcdef0123456789abcdef"',
      '{"openai_api_key": "abcdef0123456789abcdef"}',
      "https://api.example/x?api_key=abcdef0123456789&y=1",
      "stripe sk_live_abcdefghij0123456789",
      "hf hf_abcdefghijklmnopqrstuvwxyz0123",
      "DB_PASS=s3cretpassw0rd123"
    ].join("\n")
    const out = redact(text)
    expect(out).toContain("Bearer [redacted]")
    expect(out).toContain('"openai_api_key": "[redacted]')
    expect(out).toContain("?api_key=[redacted]&y=1")
    expect(out).toContain("[redacted stripe key]")
    expect(out).not.toContain("hf_abc")
    expect(out).toContain("DB_PASS=[redacted]")
  })

  it("leaves code that merely names a token alone", () => {
    for (const line of [
      "const tokenBuf = Buffer.from(token)",
      "maxTokens: computeMaxTokensForWindow",
      "see tokens: /Users/x/lib/import-token.ts",
      "--token-color: var(--primary-foreground)",
      "the password field is required and validated"
    ]) {
      expect(redact(line)).toBe(line)
    }
  })

  it("stays fast on a line built to make it backtrack", () => {
    const hostile = "pwd-".repeat(12_500) + "\n" + "secret-".repeat(5_000)
    const started = Date.now()
    cleanText(hostile)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe("parseTranscript: meta entries", () => {
  it("skips what Claude Code put in the user's turn on its own", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        isMeta: true,
        message: { content: "Base directory for this skill: /x/y/z and more" }
      }),
      JSON.stringify({
        type: "user",
        message: { content: "please run the tests now" }
      })
    ].join("\n")
    const messages = parseTranscript(jsonl)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("please run the tests now")
  })
})

describe("nosyncMarkerDir", () => {
  it("finds the marker in the directory or any directory above it", () => {
    const root = mkdtempSync(join(tmpdir(), "chatmemo-nosync-"))
    try {
      const repo = join(root, "repo")
      const deep = join(repo, "packages", "web")
      mkdirSync(deep, { recursive: true })
      expect(nosyncMarkerDir(deep)).toBeNull()
      writeFileSync(join(repo, ".chatmemo-nosync"), "")
      expect(nosyncMarkerDir(deep)).toBe(repo)
      expect(nosyncMarkerDir(repo)).toBe(repo)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
