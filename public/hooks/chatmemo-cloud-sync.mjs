#!/usr/bin/env node
/**
 * ChatMemo — sync Claude Code *cloud* sessions into memory.
 *
 * Sessions the desktop app runs in the cloud never touch the laptop, so the
 * laptop sync (scripts/sync-to-chatmemo.mjs) cannot see them. This hook runs
 * inside the cloud container instead and posts the session to ChatMemo's own
 * import endpoint, which summarises it and stores it. The container needs no
 * database or OpenRouter credentials — only:
 *
 *   CHATMEMO_IMPORT_TOKEN  the Bearer token from ChatMemo's .env.local
 *   CHATMEMO_URL           optional, defaults to https://chatmemo-one.vercel.app
 *
 * Installed by the cloud environment's setup script (docs/ADMIN_GUIDE.md,
 * "Claude Code cloud sessions"), which downloads this file from the deployed
 * app — it is served from public/ for exactly that — and registers it for the
 * Stop and SessionEnd hooks.
 *
 * Behaviour mirrors the laptop sync: first post once the session has 3 user
 * messages, again every 5 more, and once more at SessionEnd. Each post carries
 * sessionKey "claude-code:<session id>", so ChatMemo replaces the session's
 * previous row. A container can be reclaimed without SessionEnd firing; the
 * Stop posts are what survive that.
 *
 * Zero dependencies. Never blocks Claude Code: the work runs in a detached
 * child, and every outcome is logged to ~/.chatmemo-cloud/sync.log.
 */

import { spawn } from "child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs"
import { homedir } from "os"
import { basename, join } from "path"
import { fileURLToPath } from "url"

const STATE_DIR =
  process.env.CHATMEMO_STATE_DIR || join(homedir(), ".chatmemo-cloud")
const STATE_FILE = join(STATE_DIR, "sessions.json")
const LOG_FILE = join(STATE_DIR, "sync.log")

export const MIN_USER_MESSAGES = 3
export const RESYNC_GROWTH = 5

const MAX_MESSAGES = 200
const MAX_MESSAGE_CHARS = 4_000
// Most recent part only: the endpoint summarises within one function call.
const MAX_TOTAL_CHARS = 80_000

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .filter(b => b?.type === "text")
      .map(b => (b.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/** User and assistant text from a Claude Code JSONL transcript. */
export function parseTranscript(jsonl) {
  const messages = []
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.type !== "user" && entry.type !== "assistant") continue
      const text = textOf(entry.message?.content)
      if (text.length < 15) continue
      messages.push({
        role: entry.type,
        text,
        at: typeof entry.timestamp === "string" ? entry.timestamp : undefined
      })
    } catch {
      // skip malformed lines
    }
  }
  return messages
}

/** Whether a session with `userMessages` should be posted now. */
export function shouldSync(syncedUserMessages, userMessages, final) {
  if (userMessages < MIN_USER_MESSAGES) return false
  if (syncedUserMessages === undefined) return true
  const grown = userMessages - syncedUserMessages
  return final ? grown > 0 : grown >= RESYNC_GROWTH
}

/** The request body for /api/import/conversation. */
export function buildPayload({ sessionId, cwd, messages }) {
  const project = basename(cwd || "") || "Claude Code"

  // Newest first until the budget runs out, then back into order.
  const kept = []
  let total = 0
  for (const m of messages.slice(-MAX_MESSAGES).reverse()) {
    const text =
      m.text.length > MAX_MESSAGE_CHARS
        ? m.text.slice(0, MAX_MESSAGE_CHARS) + "…"
        : m.text
    if (total + text.length > MAX_TOTAL_CHARS) break
    kept.push({ role: m.role, text })
    total += text.length
  }
  kept.reverse()

  // Dated by the last message, like the laptop sync: the day the work happened.
  let date = new Date().toISOString().slice(0, 10)
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = Date.parse(messages[i].at ?? "")
    if (!Number.isNaN(at)) {
      date = new Date(at).toISOString().slice(0, 10)
      break
    }
  }

  return {
    title: `[Claude Code cloud] ${project}`,
    date,
    messages: kept,
    sessionKey: `claude-code:${sessionId}`
  }
}

/**
 * The worker's environment. Cloud containers reach the internet only through
 * an HTTPS proxy, and Node's built-in fetch ignores HTTPS_PROXY unless
 * NODE_USE_ENV_PROXY is set (Node 22.21+): without it every post went out
 * directly and was refused as "Host not in allowlist".
 */
export function workerEnv(env) {
  const proxied = Boolean(env.HTTPS_PROXY || env.https_proxy)
  return proxied ? { ...env, NODE_USE_ENV_PROXY: "1" } : env
}

// ---------------------------------------------------------------------------
// State and log
// ---------------------------------------------------------------------------

function log(message) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ")
    appendFileSync(LOG_FILE, `[${ts}] ${message}\n`)
  } catch {
    // logging must never break the hook
  }
}

function loadState() {
  try {
    return existsSync(STATE_FILE)
      ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
      : {}
  } catch {
    return {}
  }
}

function saveState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch {
    // non-fatal: the next post replaces by sessionKey anyway
  }
}

// ---------------------------------------------------------------------------
// Per-session lock
//
// Two quick turns can start two workers for one session. Their posts would
// each insert a row and then prune every other row with the same key —
// including each other's — leaving the session with none. So workers for a
// session take turns; the second re-reads the state and usually has nothing
// left to post.
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 5 * 60 * 1000

async function withLock(sessionId, fn) {
  mkdirSync(STATE_DIR, { recursive: true })
  const lock = join(STATE_DIR, `${sessionId.replace(/[^\w.-]/g, "_")}.lock`)
  const deadline = Date.now() + 150_000

  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" })
      break
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock)
          continue
        }
      } catch {
        continue // released between the two calls
      }
      if (Date.now() > deadline) {
        log(`${sessionId}: another post still running — skipped this turn`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }
  }

  try {
    await fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

async function work(hook) {
  await withLock(hook.session_id, () => post(hook))
}

async function post({ transcript_path, session_id, cwd, event }) {
  const token = process.env.CHATMEMO_IMPORT_TOKEN
  if (!token) {
    log(`${session_id}: CHATMEMO_IMPORT_TOKEN is not set in this environment`)
    return
  }
  const base = (
    process.env.CHATMEMO_URL || "https://chatmemo-one.vercel.app"
  ).replace(/\/+$/, "")

  let messages
  try {
    messages = parseTranscript(readFileSync(transcript_path, "utf8"))
  } catch (e) {
    log(`${session_id}: transcript unreadable — ${e.message}`)
    return
  }

  const userMessages = messages.filter(m => m.role === "user").length
  const state = loadState()
  if (!shouldSync(state[session_id], userMessages, event === "SessionEnd")) {
    return
  }

  const payload = buildPayload({ sessionId: session_id, cwd, messages })

  try {
    const res = await fetch(`${base}/api/import/conversation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000)
    })
    const body = await res.text().catch(() => "")
    if (!res.ok) {
      log(`${session_id}: HTTP ${res.status} ${body.slice(0, 300)}`)
      return
    }
    // Recorded even when ChatMemo judged it not worth remembering, so a short
    // session is not re-posted every turn; growth still re-posts it.
    state[session_id] = userMessages
    saveState(state)
    log(`${session_id}: posted ${userMessages} user msgs — ${body.slice(0, 200)}`)
  } catch (e) {
    log(`${session_id}: post failed — ${e?.message || e}`)
  }
}

// ---------------------------------------------------------------------------
// Entry: read the hook payload, hand it to a detached worker, return at once.
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv[2] === "--worker") {
    await work(JSON.parse(process.argv[3] ?? "{}"))
    return
  }

  let raw = ""
  for await (const chunk of process.stdin) raw += chunk

  let hook
  try {
    hook = JSON.parse(raw)
  } catch {
    return
  }
  if (!hook.transcript_path || !hook.session_id) return

  const payload = JSON.stringify({
    transcript_path: hook.transcript_path,
    session_id: hook.session_id,
    cwd: hook.cwd ?? "",
    event: hook.hook_event_name ?? "Stop"
  })

  spawn(
    process.execPath,
    ["--no-warnings", fileURLToPath(import.meta.url), "--worker", payload],
    { detached: true, stdio: "ignore", env: workerEnv(process.env) }
  ).unref()
}

// Run only as a script, so tests can import the helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch(e => log(`hook error: ${e?.message || e}`))
    .finally(() => process.exit(0))
}
