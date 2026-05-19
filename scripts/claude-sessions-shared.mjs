/**
 * Shared utilities for Claude Code session scripts:
 *   - import-claude-sessions.mjs  (bulk historical import)
 *   - watch-claude-sessions.mjs   (background daemon)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync
} from "fs"
import { homedir } from "os"
import { join } from "path"

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

export const HOME = homedir()
export const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects")
export const CONFIG_DIR = join(HOME, ".chatmemo")
export const CONFIG_FILE = join(CONFIG_DIR, "config.json")
export const SESSIONS_FILE = join(CONFIG_DIR, "imported-sessions.json")

export const MIN_USER_MESSAGES = 3
export const MAX_MESSAGES = 200
export const SUMMARIZE_MODEL = "openai/gpt-oss-120b:free"

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
      messages.push({ role: entry.type === "user" ? "user" : "assistant", text })
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

export async function summarize(openrouterKey, title, date, messages) {
  const body = messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n")
  const input = `## ${title} (${date})\n\n${body}`

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`
      },
      body: JSON.stringify({
        model: SUMMARIZE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input }
        ],
        temperature: 0.3,
        max_tokens: 700
      }),
      signal: AbortSignal.timeout(60_000)
    })

    if (!res.ok) return null
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content ?? "").trim()
    if (!text || text === "SKIP" || text.split(/\s+/).length < 10) return null
    return text
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Supabase insert
// ---------------------------------------------------------------------------

export async function insertSummary(supabaseUrl, serviceRoleKey, userId, content) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/summaries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ user_id: userId, content }),
      signal: AbortSignal.timeout(10_000)
    })
    return res.ok || res.status === 201
  } catch {
    return false
  }
}
