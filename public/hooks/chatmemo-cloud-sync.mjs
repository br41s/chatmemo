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
 *   CHATMEMO_IMPORT_TOKEN  the cloud import token (CHATMEMO_CLOUD_IMPORT_TOKEN
 *                          in ChatMemo's .env.local; the general token works
 *                          too, but a leak of it then reaches more)
 *   CHATMEMO_URL           optional, defaults to https://chatmemo-one.vercel.app
 *
 * Installed by the cloud environment's setup script (docs/ADMIN_GUIDE.md,
 * "Claude Code cloud sessions"), which downloads this file from the deployed
 * app — it is served from public/ for exactly that — checks its hash against
 * the one in the guide, and registers it for the Stop and SessionEnd hooks.
 *
 * Behaviour mirrors the laptop sync: first post once the session has 3 user
 * messages, again every 5 more, and once more at SessionEnd. Each post carries
 * sessionKey "claude-code:<session id>", so ChatMemo replaces the session's
 * previous row. A container can be reclaimed without SessionEnd firing; the
 * Stop posts are what survive that.
 *
 * What leaves the container is user and assistant text only, after two
 * passes: blocks Claude Code injects into user turns (command output, system
 * reminders) are dropped, and anything shaped like a credential is replaced
 * before the post. A `.chatmemo-nosync` file in the session's working
 * directory, or any directory above it, keeps that session out altogether.
 *
 * Zero dependencies, and the laptop scripts import the pure helpers below so
 * both paths clean a transcript the same way. Never blocks Claude Code: the
 * work runs in a detached child, and every outcome is logged to
 * ~/.chatmemo-cloud/sync.log.
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
import { basename, dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const STATE_DIR =
  process.env.CHATMEMO_STATE_DIR || join(homedir(), ".chatmemo-cloud")
const STATE_FILE = join(STATE_DIR, "sessions.json")
const LOG_FILE = join(STATE_DIR, "sync.log")

export const MIN_USER_MESSAGES = 3
export const RESYNC_GROWTH = 5

/** A file with this name in the working directory opts the session out. */
export const NOSYNC_MARKER = ".chatmemo-nosync"

const MAX_MESSAGES = 200
const MAX_MESSAGE_CHARS = 4_000
// Most recent part only: the endpoint summarises within one function call.
const MAX_TOTAL_CHARS = 80_000

// ---------------------------------------------------------------------------
// Cleaning a transcript (exported: the laptop scripts use the same passes)
// ---------------------------------------------------------------------------

// Claude Code puts things into a user turn that the person never typed: the
// output of a `!` command, a local slash command's output, and the system
// reminders that carry CLAUDE.md and hook context. None of it is the
// conversation, and command output is where `cat .env` ends up. The blocks
// start a line of their own, which is what is matched: a tag named in prose
// ("why does the hook drop <system-reminder> blocks?") stays.
const INJECTED_TAGS =
  "bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|system-reminder"
const INJECTED_BLOCK_RE = new RegExp(
  `^[ \\t]*<(${INJECTED_TAGS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>[ \\t]*`,
  "gim"
)
const UNCLOSED_INJECTED_BLOCK_RE = new RegExp(
  `^[ \\t]*<(${INJECTED_TAGS})(?:\\s[^>]*)?>[\\s\\S]*$`,
  "im"
)

/** `text` without the blocks Claude Code injected into it. */
export function stripInjectedBlocks(text) {
  return text
    .replace(INJECTED_BLOCK_RE, "")
    .replace(UNCLOSED_INJECTED_BLOCK_RE, "")
}

// Shapes of credentials, replaced wherever they appear. The summary this text
// becomes is injected into every later chat and sent to every provider the
// user picks; a key pasted once would travel for good.
//
// Every quantifier that can run along a line is bounded: these patterns run
// on every message of a transcript after every turn, and an unbounded one
// turned a pasted `pwd-pwd-pwd-…` line into seconds of CPU per Stop.
const REDACTIONS = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[redacted private key]"
  ],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[redacted jwt]"],
  // scheme://user:password@host — the password runs to the last `@` before
  // the host, so one containing `@` goes whole.
  [
    /\b([a-z][a-z0-9+.-]{0,20}:\/\/)([^\s/:@]{1,80}):([^\s]{1,200})@(?=[\w.-]{1,253}(?:[:/?#]|\s|$))/gi,
    "$1$2:[redacted]@"
  ],
  [/\bBearer\s{1,4}[A-Za-z0-9._~+/-]{16,}=*/g, "Bearer [redacted]"],
  [/\bsk-[\w-]{20,}/g, "[redacted token]"],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, "[redacted stripe key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted aws key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[redacted github token]"],
  [/\bgithub_pat_[\w]{20,}/g, "[redacted github token]"],
  [/\bglpat-[\w-]{20,}/g, "[redacted gitlab token]"],
  [/\bxox[baprs]-[\w-]{10,}/g, "[redacted slack token]"],
  [/\bAIza[\w-]{35}\b/g, "[redacted google key]"],
  [/\b(?:hf|npm)_[A-Za-z0-9]{20,}/g, "[redacted token]"],
  [/\bsb(?:p|_secret|_publishable)_[\w-]{20,}/g, "[redacted supabase key]"],
  // ?api_key=… in a URL
  [
    /([?&](?:api_?key|access_?token|token|secret|password|key))=[^&\s"']{8,}/gi,
    "$1=[redacted]"
  ],
  // NAME=value, name: value and "name": "value", for names that say what
  // they hold. The name stays so the summary can still say which setting
  // was discussed. Only a value that looks like a secret goes: quoted, or
  // carrying a digit; `tokenBuf = Buffer.from(token)` and
  // `maxTokens: computeMaxTokensForWindow` are code, not credentials.
  [
    /(?<![\w-])([\w-]{0,40}?(?:api[_-]?key|secret|token|password|passwd|pwd|pass(?![a-z]))[\w-]{0,40})(["']?\s{0,8}[=:]\s{0,8}["']?)([^\s"'`]{12,})/gi,
    (match, name, separator, value) =>
      looksLikeSecret(
        value,
        /["']\s{0,8}$/.test(separator) || /["']$/.test(separator)
      )
        ? `${name}${separator}[redacted]`
        : match
  ]
]

function looksLikeSecret(value, quoted) {
  // Already handled by an earlier rule: not a second pass over its remainder.
  if (value.startsWith("[redacted")) return false
  if (/[(/]/.test(value)) return false
  return quoted || /\d/.test(value)
}

/** `text` with anything shaped like a credential replaced. */
export function redact(text) {
  let out = text
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

// Only this much of a message is kept by `capMessages`, so only a little
// more than that is worth cleaning: a bound on what the patterns run over.
const MAX_CLEAN_CHARS = 12_000

/** Both passes, in the order they are meant to run. */
export function cleanText(text) {
  const stripped = stripInjectedBlocks(text)
  const bounded =
    stripped.length > MAX_CLEAN_CHARS
      ? stripped.slice(0, MAX_CLEAN_CHARS)
      : stripped
  return redact(bounded).trim()
}

/**
 * The directory, from `dir` upwards, that carries the opt-out marker — or
 * null. A marker at a repository's root covers every session started in a
 * subdirectory of it.
 */
export function nosyncMarkerDir(dir) {
  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, NOSYNC_MARKER))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === "string") return content
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
      // A meta entry is text Claude Code put in the user's turn — a skill's
      // body, a message from another session — not something the user said.
      if (entry.isMeta) continue
      const text = cleanText(textOf(entry.message?.content))
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

/**
 * The most recent messages that fit one post: newest first until the budget
 * runs out, then back into order. Each message is cut to its own cap.
 */
export function capMessages(messages) {
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
  return kept.reverse()
}

/** The UTC date of the last message that carries a time, else today. */
export function lastMessageDate(messages, fallback = new Date()) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = Date.parse(messages[i].at ?? "")
    if (!Number.isNaN(at)) return new Date(at).toISOString().slice(0, 10)
  }
  return fallback.toISOString().slice(0, 10)
}

/** The request body for /api/import/conversation. */
export function buildPayload({ sessionId, cwd, messages }) {
  const project = basename(cwd || "") || "Claude Code"
  return {
    title: `[Claude Code cloud] ${project}`,
    // Dated by the last message, like the laptop sync: the day the work happened.
    date: lastMessageDate(messages),
    messages: capMessages(messages),
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

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
}

function log(message) {
  try {
    ensureStateDir()
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ")
    appendFileSync(LOG_FILE, `[${ts}] ${message}\n`, { mode: 0o600 })
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
    ensureStateDir()
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 })
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
  ensureStateDir()
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
  // The token travels in a header; never over plain HTTP.
  if (!base.startsWith("https://")) {
    log(`${session_id}: CHATMEMO_URL must be https — not posting`)
    return
  }

  const optedOut = cwd ? nosyncMarkerDir(cwd) : null
  if (optedOut) {
    log(`${session_id}: ${NOSYNC_MARKER} present in ${optedOut} — not synced`)
    return
  }

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
      log(`${session_id}: HTTP ${res.status} ${body.slice(0, 120)}`)
      return
    }
    // Recorded even when ChatMemo judged it not worth remembering, so a short
    // session is not re-posted every turn; growth still re-posts it.
    state[session_id] = userMessages
    saveState(state)
    log(
      `${session_id}: posted ${userMessages} user msgs — ${body.slice(0, 120)}`
    )
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

// Run only as a script, so tests and the laptop scripts can import the
// helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch(e => log(`hook error: ${e?.message || e}`))
    .finally(() => process.exit(0))
}
