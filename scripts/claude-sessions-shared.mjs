/**
 * Shared utilities for Claude Code session scripts:
 *   - import-claude-sessions.mjs  (bulk historical import)
 *   - watch-claude-sessions.mjs   (background daemon)
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
export const MAX_MESSAGES = 200
// Tried in order until one answers. The free variant was listed first until
// OpenRouter withdrew it (404 "unavailable for free", 2026-09-29): every call
// then paid for the fallback anyway, after a request that could only fail.
// Keep in sync with lib/server/openrouter.ts.
export const SUMMARIZE_MODELS = ["openai/gpt-oss-120b"]
// gpt-oss's reasoning counts against max_tokens; without headroom a long
// session could spend it all and return no summary. Mirrors
// lib/server/openrouter.ts.
const REASONING_HEADROOM_TOKENS = 2_000
export const SUMMARIZE_MODEL = SUMMARIZE_MODELS[0]

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Load ~/.chatmemo/config.json.
 * Exits the process with an error message if missing or malformed.
 */
export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    console.error(
      "ChatMemo config not found. Run scripts/chatmemo-hook-setup.mjs first."
    )
    process.exit(1)
  }
  let config
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    console.error("Failed to parse ~/.chatmemo/config.json")
    process.exit(1)
  }
  const { supabaseUrl, serviceRoleKey, openrouterKey, userId } = config
  if (!supabaseUrl || !serviceRoleKey || !openrouterKey || !userId) {
    console.error(
      "config.json is missing required fields: supabaseUrl, serviceRoleKey, openrouterKey, userId"
    )
    process.exit(1)
  }
  return config
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
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
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
      const text = extractText(entry.message?.content)
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
// LLM summarisation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a memory assistant. You are given a Claude Code session transcript between a developer and an AI coding assistant.

Your job is to extract a detailed, durable memory summary that will help understand this developer's work and preferences.

Output bullet points only — do NOT include a header, date, or title. Start directly with the first bullet point.

Extract and preserve:
- Projects worked on (name, language, architecture, current status)
- Problems solved and how they were solved
- Technical decisions and their rationale
- Tools, frameworks, libraries used
- Patterns, preferences, working style
- Anything useful for future sessions

Be specific. Preserve project names, file paths when relevant, technology choices, and concrete facts.

Output: plain text only, up to 500 words.
If the session contains nothing worth remembering (e.g. only tool calls, no real work), output only: SKIP`

export async function summarize(
  openrouterKey,
  title,
  date,
  messages,
  log = console.error
) {
  const body = messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n")
  const input = `## ${title} (${date})\n\n${body}`

  for (const model of SUMMARIZE_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: input }
          ],
          temperature: 0.3,
          max_tokens: 700 + REASONING_HEADROOM_TOKENS,
          reasoning: { effort: "low" }
        }),
        signal: AbortSignal.timeout(60_000)
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => "")
        log(`summarize: ${model} → HTTP ${res.status} ${errBody.slice(0, 200)}`)
        continue // try the next model in the fallback chain
      }

      const data = await res.json()
      const text = (data.choices?.[0]?.message?.content ?? "").trim()
      if (!text && data.choices?.[0]?.finish_reason === "length") {
        // Cut off before answering — a failure to retry, not "nothing here".
        log(
          `summarize: ${model} → hit its token limit before any text (usage ${JSON.stringify(data.usage ?? null)})`
        )
        continue
      }
      // Valid empty/SKIP result — not a failure, so stop here (don't fall back).
      if (!text || text === "SKIP" || text.split(/\s+/).length < 10) return null
      return text
    } catch (e) {
      log(`summarize: ${model} → ${e?.message || e}`)
      // try the next model in the fallback chain
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Supabase writes
//
// Both return why they failed. They used to return a bare boolean, and the
// Stop hook logged nothing at all, so a rotated key or a moved project left no
// trace — the sessions simply stopped arriving.
// ---------------------------------------------------------------------------

function supabaseHeaders(serviceRoleKey) {
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  }
}

async function describeFailure(res) {
  const body = await res.text().catch(() => "")
  return `HTTP ${res.status} ${body.slice(0, 200)}`.trim()
}

/** @returns {Promise<{ ok: boolean, id?: string, error?: string }>} */
export async function insertSummary(
  supabaseUrl,
  serviceRoleKey,
  userId,
  content
) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/summaries?select=id`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(serviceRoleKey),
        Prefer: "return=representation"
      },
      body: JSON.stringify({ user_id: userId, content }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { ok: false, error: await describeFailure(res) }
    const rows = await res.json().catch(() => [])
    return { ok: true, id: Array.isArray(rows) ? rows[0]?.id : undefined }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
export async function deleteSummary(supabaseUrl, serviceRoleKey, userId, id) {
  try {
    const url =
      `${supabaseUrl}/rest/v1/summaries` +
      `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`
    const res = await fetch(url, {
      method: "DELETE",
      headers: supabaseHeaders(serviceRoleKey),
      signal: AbortSignal.timeout(10_000)
    })
    return res.ok
      ? { ok: true }
      : { ok: false, error: await describeFailure(res) }
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
    mkdirSync(CONFIG_DIR, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ")
    appendFileSync(SYNC_LOG_FILE, `[${ts}] ${message}\n`)
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
// previous one. The entry in imported-sessions.json records what was synced:
//
//   { rowId, userMessages, mtime, syncedAt }   — synced; rowId is its row
//   { userMessages, mtime, skippedAt }         — too short when last seen
//
// Entries written before this change are strings: an ISO time (synced, row
// unknown — left alone, since without its id the old row could not be
// replaced and a second one would duplicate it) or "skipped:<time>" (too short
// then; synced now if it has grown).
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
 * @returns {"insert" | "replace" | "skip"}
 */
export function syncDecision(entry, userMessages, { final = false } = {}) {
  if (userMessages < MIN_USER_MESSAGES) return "skip"
  if (entry === undefined || entry === null) return "insert"
  if (typeof entry === "string") {
    return entry.startsWith("skipped:") ? "insert" : "skip"
  }
  if (!entry.rowId) return "insert"
  const grown = userMessages - (entry.userMessages ?? 0)
  if (final) return grown > 0 ? "replace" : "skip"
  return grown >= RESYNC_GROWTH ? "replace" : "skip"
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
// session at once. Two replaces racing would both insert and both delete the
// same old row, leaving a duplicate. A lock file makes them take turns; the
// second re-reads the tracking file and usually finds nothing left to do.
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 5 * 60 * 1000

export async function withSessionLock(key, fn, { waitMs = 150_000 } = {}) {
  mkdirSync(LOCKS_DIR, { recursive: true })
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

/**
 * Summarise a session and store it, replacing the row its last sync wrote.
 *
 * Insert first, then delete the previous row: the other order would leave the
 * session with no memory at all if the insert failed. The worst case this way
 * is a brief duplicate.
 *
 * Holds the session's lock and re-reads the tracking file inside it, so the
 * decision is made against what the other writers have already done.
 *
 * @returns {Promise<"inserted" | "replaced" | "skipped" | "failed" | "busy">}
 */
export async function syncSession({
  config,
  key,
  messages,
  mtime,
  header,
  title,
  final = false,
  log = appendSyncLog
}) {
  const { supabaseUrl, serviceRoleKey, openrouterKey, userId } = config

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

    const date = activityDate(messages, mtime)
    const factsText = await summarize(
      openrouterKey,
      title,
      date,
      messages.slice(-MAX_MESSAGES),
      message => log(`${key}: ${message}`)
    )
    if (!factsText) {
      log(`${key}: summary failed or empty — will retry`)
      return "failed"
    }

    const inserted = await insertSummary(
      supabaseUrl,
      serviceRoleKey,
      userId,
      `${header(date)}\n\n${factsText}`
    )
    if (!inserted.ok) {
      log(`${key}: insert failed — ${inserted.error}`)
      return "failed"
    }

    const previous = decision === "replace" ? entry.rowId : undefined
    if (previous) {
      const removed = await deleteSummary(
        supabaseUrl,
        serviceRoleKey,
        userId,
        previous
      )
      if (!removed.ok) {
        log(
          `${key}: new row saved, old row ${previous} not removed — ${removed.error}`
        )
      }
    }

    if (!inserted.id) {
      // Stored, but without its id it can never be replaced; mark it done the
      // old way rather than let the next sync add a second row beside it.
      sessions[key] = new Date().toISOString()
      saveSessionsFile(sessions)
      log(`${key}: inserted, but no row id came back — will not re-sync`)
      return previous ? "replaced" : "inserted"
    }

    sessions[key] = {
      rowId: inserted.id,
      userMessages,
      mtime,
      syncedAt: new Date().toISOString()
    }
    saveSessionsFile(sessions)
    log(
      `${key}: ${previous ? "replaced" : "inserted"} (${userMessages} user msgs)`
    )
    return previous ? "replaced" : "inserted"
  })

  return outcome ?? "busy"
}
