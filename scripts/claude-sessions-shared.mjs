/**
 * Shared utilities for Claude Code session scripts:
 *   - sync-to-chatmemo.mjs        (Stop / SessionEnd hook)
 *   - import-claude-sessions.mjs  (bulk historical import)
 *   - watch-claude-sessions.mjs   (background daemon)
 *
 * The laptop holds no database or OpenRouter credentials. Every session is
 * posted to ChatMemo's own import endpoint with the import token, like the
 * cloud hook does; the server summarises it and stores it, replacing the
 * session's previous row by key. ~/.chatmemo/config.json carries the token,
 * the deployment URL and the exclusions, nothing else.
 */

import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from "fs"
import { homedir } from "os"
import { join } from "path"
import {
  capMessages,
  cleanText,
  NOSYNC_MARKER
} from "../public/hooks/chatmemo-cloud-sync.mjs"

export { NOSYNC_MARKER }

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

export const HOME = homedir()
export const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects")
// Overridable so a test, or a second setup, can keep its state elsewhere.
export const CONFIG_DIR =
  process.env.CHATMEMO_CONFIG_DIR || join(HOME, ".chatmemo")
export const CONFIG_FILE = join(CONFIG_DIR, "config.json")
export const SESSIONS_FILE = join(CONFIG_DIR, "imported-sessions.json")
export const SYNC_LOG_FILE = join(CONFIG_DIR, "sync.log")
export const LOCKS_DIR = join(CONFIG_DIR, "locks")

export const MIN_USER_MESSAGES = 3

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * The config written by chatmemo-hook-setup.mjs, checked. Returns null with
 * the reason when it is missing or from before the token-only setup.
 *
 * @returns {{ config?: object, error?: string }}
 */
export function readConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return { error: `no ${CONFIG_FILE} — run npm run setup:sync` }
  }
  let config
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    return { error: `unreadable ${CONFIG_FILE}` }
  }
  if (!config.importToken || !config.chatmemoUrl) {
    return {
      error: "config.json predates the token-only sync — run npm run setup:sync"
    }
  }
  if (!String(config.chatmemoUrl).startsWith("https://")) {
    return {
      error: "chatmemoUrl must be https — the token travels in a header"
    }
  }
  return { config }
}

/** Like readConfig, for the interactive scripts: exits with the reason. */
export function loadConfig() {
  const { config, error } = readConfig()
  if (!config) {
    console.error(`ChatMemo: ${error}`)
    process.exit(1)
  }
  return config
}

/** Where the config lives, created so only this user can read it. */
export function ensureConfigDir() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
}

// ---------------------------------------------------------------------------
// Sessions tracking
// ---------------------------------------------------------------------------

export function loadSessions() {
  return existsSync(SESSIONS_FILE)
    ? JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))
    : {}
}

export function saveSessionsFile(sessions) {
  try {
    ensureConfigDir()
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), {
      mode: 0o600
    })
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Scan ~/.claude/projects/ and return all UUID-named *.jsonl session files.
 * Skips `agent-*` files (sub-task sessions spawned by tool use).
 *
 * @returns Array of { path, sessionId, projectSlug, mtime }
 */
export function findAllJSONLFiles(baseDir = CLAUDE_PROJECTS_DIR) {
  if (!existsSync(baseDir)) return []

  const results = []
  for (const projectSlug of readdirSync(baseDir)) {
    const projectDir = join(baseDir, projectSlug)
    try {
      if (!statSync(projectDir).isDirectory()) continue
    } catch {
      continue
    }

    for (const file of readdirSync(projectDir)) {
      if (!file.endsWith(".jsonl")) continue
      const sessionId = file.replace(".jsonl", "")
      // Only standard UUID sessions — skip agent-* sub-task files
      if (!/^[0-9a-f-]{36}$/.test(sessionId)) continue
      const filePath = join(projectDir, file)
      let mtime = 0
      try {
        mtime = statSync(filePath).mtime.getTime()
      } catch {
        continue
      }
      results.push({ path: filePath, sessionId, projectSlug, mtime })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

export function parseJSONL(filePath) {
  let lines
  try {
    lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean)
  } catch {
    return []
  }

  const messages = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type !== "user" && entry.type !== "assistant") continue
      // Injected blocks dropped and credentials replaced, as the cloud hook
      // does: what is posted is what was said, and nothing that unlocks
      // anything.
      const text = cleanText(extractText(entry.message?.content))
      if (!text || text.length < 15) continue
      messages.push({
        role: entry.type === "user" ? "user" : "assistant",
        text,
        // When it was said. The session is dated by its last message, not by
        // the file's mtime, which moves whenever anything touches the file.
        at: typeof entry.timestamp === "string" ? entry.timestamp : undefined
      })
    } catch {
      // skip malformed lines
    }
  }

  return messages
}

function extractText(content) {
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Convert a Claude project slug to a readable name.
 * e.g. "-Users-brais-VSCODE-biglobster" → "biglobster"
 */
export function slugToProjectName(slug) {
  const parts = slug.split("-").filter(Boolean)
  return parts[parts.length - 1] || slug
}

/**
 * A Claude project slug for a path: the way ~/.claude/projects names the
 * directory for "/Users/x/VSCODE/foo" is "-Users-x-VSCODE-foo".
 */
export function pathToSlug(path) {
  return path.replace(/\/+$/, "").replace(/[^\w]/g, "-")
}

/** Get YYYY-MM-DD from a file's mtime. Falls back to today. */
export function mtimeToDate(mtime) {
  return mtime > 0
    ? new Date(mtime).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
}

/**
 * The UTC date of a session's last message, or of the file's mtime when no
 * message carries a timestamp (Copilot transcripts, older formats).
 *
 * Dating by mtime put a session worked on yesterday under today as soon as
 * anything touched its file, and "yesterday's conversations" found nothing.
 */
export function activityDate(messages, mtime) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = Date.parse(messages[i].at ?? "")
    if (!Number.isNaN(at)) return new Date(at).toISOString().slice(0, 10)
  }
  return mtimeToDate(mtime)
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Exclusions
//
// Not every project belongs in memory. Two ways to keep one out: a
// `.chatmemo-nosync` file in its directory (checked by the hook, which knows
// the cwd), and `excludeProjects` in config.json — path prefixes, checked
// against the cwd by the hook and against the project slug by the watcher
// and the importers, which only see ~/.claude/projects/<slug>.
// ---------------------------------------------------------------------------

/**
 * Why a session is excluded, or null.
 *
 * @param {object} config
 * @param {{ cwd?: string, projectSlug?: string }} project
 */
export function exclusionReason(config, { cwd, projectSlug } = {}) {
  if (cwd && existsSync(join(cwd, NOSYNC_MARKER))) {
    return `${NOSYNC_MARKER} present in ${cwd}`
  }
  const prefixes = Array.isArray(config?.excludeProjects)
    ? config.excludeProjects.filter(p => typeof p === "string" && p)
    : []
  for (const prefix of prefixes) {
    if (
      cwd &&
      (cwd === prefix || cwd.startsWith(prefix.replace(/\/+$/, "") + "/"))
    ) {
      return `excluded by config (${prefix})`
    }
    if (projectSlug && projectSlug.startsWith(pathToSlug(prefix))) {
      return `excluded by config (${prefix})`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Posting to ChatMemo
// ---------------------------------------------------------------------------

/**
 * POST a session to /api/import/conversation.
 *
 * @returns {Promise<{ ok: boolean, inserted?: number, reason?: string, error?: string }>}
 */
export async function postConversation(config, payload) {
  const base = String(config.chatmemoUrl).replace(/\/+$/, "")
  try {
    const res = await fetch(`${base}/api/import/conversation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.importToken}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000)
    })
    const text = await res.text().catch(() => "")
    let body = {}
    try {
      body = JSON.parse(text)
    } catch {
      // not JSON: reported by status below
    }
    if (!res.ok) {
      // Status and the server's short reason; never the body wholesale, which
      // on a database error can quote the row.
      const reason = body.reason || body.message || ""
      return {
        ok: false,
        error: `HTTP ${res.status} ${reason}`.trim().slice(0, 160)
      }
    }
    return { ok: true, inserted: body.inserted ?? 0, reason: body.reason }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

// ---------------------------------------------------------------------------
// Sync log
// ---------------------------------------------------------------------------

/** Append a timestamped line to ~/.chatmemo/sync.log. Never throws. */
export function appendSyncLog(message) {
  try {
    ensureConfigDir()
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ")
    appendFileSync(SYNC_LOG_FILE, `[${ts}] ${message}\n`, { mode: 0o600 })
  } catch {
    // Logging must never break a sync.
  }
}

// ---------------------------------------------------------------------------
// When to sync a session
//
// A session used to be summarised once, the moment it reached three user
// messages, and marked done. The Stop hook fires after every turn, so that
// moment was the third turn: a day's session was remembered by its opening
// and nothing after it, and the watcher then skipped it as already imported.
//
// Now a session is re-summarised as it grows and the new row replaces the
// previous one — by key, on the server. The entry in imported-sessions.json
// records what was synced:
//
//   { userMessages, mtime, syncedAt }           — synced
//   { rowId, userMessages, mtime, syncedAt }    — synced by the old laptop
//                                                 path, which wrote the row
//                                                 itself; its id is sent once
//                                                 so the server can retire it
//   { userMessages, mtime, skippedAt }          — too short when last seen
//
// Entries written before this change are strings: an ISO time (synced, row
// unknown — left alone, since nothing could retire the old row and a second
// one would duplicate it) or "skipped:<time>" (too short then; synced now if
// it has grown).
// ---------------------------------------------------------------------------

/** User messages a live session must gain before it is summarised again. */
export const RESYNC_GROWTH = 5

/**
 * What to do with a session given its tracking entry and current size.
 *
 * `final` is true when the session has ended or gone idle: any growth then
 * earns a last sync. Mid-session, the Stop hook waits for RESYNC_GROWTH more
 * messages so it does not summarise after every turn.
 *
 * @returns {"sync" | "skip"}
 */
export function syncDecision(entry, userMessages, { final = false } = {}) {
  if (userMessages < MIN_USER_MESSAGES) return "skip"
  if (entry === undefined || entry === null) return "sync"
  if (typeof entry === "string") {
    return entry.startsWith("skipped:") ? "sync" : "skip"
  }
  if (entry.syncedAt === undefined && entry.rowId === undefined) return "sync"
  const grown = userMessages - (entry.userMessages ?? 0)
  if (final) return grown > 0 ? "sync" : "skip"
  return grown >= RESYNC_GROWTH ? "sync" : "skip"
}

/**
 * Whether a session file is worth parsing again. Cheap, so the watcher can
 * skip the hundreds of unchanged transcripts it would otherwise re-read on
 * every poll.
 */
export function hasChangedSince(entry, fileMtime) {
  if (entry === undefined || entry === null) return true
  if (typeof entry === "string") {
    if (!entry.startsWith("skipped:")) return false
    const at = Date.parse(entry.slice("skipped:".length))
    return Number.isNaN(at) || fileMtime > at
  }
  return fileMtime > (entry.mtime ?? 0)
}

// ---------------------------------------------------------------------------
// Per-session lock
//
// The Stop hook, the SessionEnd hook and the watcher can all reach the same
// session at once. Two posts racing would each insert a row and prune the
// other's, leaving the session with none. A lock file makes them take turns;
// the second re-reads the tracking file and usually finds nothing left to do.
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 5 * 60 * 1000

export async function withSessionLock(key, fn, { waitMs = 150_000 } = {}) {
  mkdirSync(LOCKS_DIR, { recursive: true, mode: 0o700 })
  const lock = join(LOCKS_DIR, `${key.replace(/[^\w.-]/g, "_")}.lock`)
  const deadline = Date.now() + waitMs

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
      if (Date.now() > deadline) return undefined
      await sleep(2_000)
    }
  }

  try {
    return await fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Sync one session
// ---------------------------------------------------------------------------

/** The server-side key a tracking key is posted under. */
export function sessionKeyFor(key) {
  return key.startsWith("copilot:") ? key : `claude-code:${key}`
}

/**
 * Post a session to ChatMemo, which summarises it and replaces the row its
 * last post wrote.
 *
 * Holds the session's lock and re-reads the tracking file inside it, so the
 * decision is made against what the other writers have already done.
 *
 * @returns {Promise<"synced" | "skipped" | "excluded" | "failed" | "busy">}
 */
export async function syncSession({
  config,
  key,
  messages,
  mtime,
  title,
  project = {},
  final = false,
  log = appendSyncLog
}) {
  const excluded = exclusionReason(config, project)
  if (excluded) {
    log(`${key}: ${excluded} — not synced`)
    return "excluded"
  }

  const outcome = await withSessionLock(key, async () => {
    const sessions = loadSessions()
    const entry = sessions[key]
    const userMessages = messages.filter(m => m.role === "user").length
    const decision = syncDecision(entry, userMessages, { final })

    if (decision === "skip") {
      if (userMessages < MIN_USER_MESSAGES && final && !entry) {
        sessions[key] = {
          userMessages,
          mtime,
          skippedAt: new Date().toISOString()
        }
        saveSessionsFile(sessions)
      }
      return "skipped"
    }

    const payload = {
      title,
      date: activityDate(messages, mtime),
      messages: capMessages(messages),
      sessionKey: sessionKeyFor(key)
    }
    // A row the old laptop path wrote has no key on the server; its id goes
    // along once so the server retires it instead of leaving a duplicate.
    const previousRowId =
      entry && typeof entry === "object" && entry.rowId
        ? entry.rowId
        : undefined
    if (previousRowId) payload.replaceRowId = previousRowId

    const posted = await postConversation(config, payload)
    if (!posted.ok) {
      log(`${key}: post failed — ${posted.error}`)
      return "failed"
    }

    sessions[key] = {
      userMessages,
      mtime,
      syncedAt: new Date().toISOString()
    }
    saveSessionsFile(sessions)
    log(
      `${key}: posted ${userMessages} user msgs — ${
        posted.inserted ? "stored" : posted.reason || "not stored"
      }`
    )
    return "synced"
  })

  return outcome ?? "busy"
}
