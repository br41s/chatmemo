#!/usr/bin/env node
/**
 * Claude Code Stop hook — syncs the current session transcript to ChatMemo.
 *
 * Registered in ~/.claude/settings.json by scripts/chatmemo-hook-setup.mjs.
 * Reads config from ~/.chatmemo/config.json (created by setup script).
 *
 * Behaviour:
 *  - Fires after every Claude Code turn (Stop hook)
 *  - Imports each session exactly once, after it reaches MIN_USER_MESSAGES
 *  - Tracks imported sessions in ~/.chatmemo/imported-sessions.json
 *  - Calls Supabase REST + OpenRouter directly — zero npm dependencies
 *  - Always exits 0 so it never blocks Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_DIR = join(homedir(), ".chatmemo")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const SESSIONS_FILE = join(CONFIG_DIR, "imported-sessions.json")
const MIN_USER_MESSAGES = 3
const MAX_MESSAGES = 200 // cap to avoid huge payloads

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Read hook input from stdin
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk

  let hook
  try {
    hook = JSON.parse(raw)
  } catch {
    return // malformed input — silent exit
  }

  const { transcript_path, session_id, cwd = "" } = hook
  if (!transcript_path || !session_id) return

  // Load ChatMemo config
  if (!existsSync(CONFIG_FILE)) return
  let config
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    return
  }

  const { supabaseUrl, serviceRoleKey, openrouterKey, userId } = config
  if (!supabaseUrl || !serviceRoleKey || !openrouterKey || !userId) return

  // Skip already-imported sessions
  const sessions = existsSync(SESSIONS_FILE)
    ? JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))
    : {}
  if (sessions[session_id]) return

  // Parse JSONL transcript
  let lines
  try {
    lines = readFileSync(transcript_path, "utf8").split("\n").filter(Boolean)
  } catch {
    return
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

  const userMessages = messages.filter(m => m.role === "user")
  if (userMessages.length < MIN_USER_MESSAGES) return // too short, skip

  // Cap message count to avoid huge payloads
  const capped = messages.slice(-MAX_MESSAGES)

  // Build title from cwd + date
  const projectName = cwd.split("/").filter(Boolean).pop() || "Claude Code"
  const date = new Date().toISOString().slice(0, 10)
  const title = `[Claude Code] ${projectName} — ${date}`

  // Summarize via OpenRouter
  const summaryText = await summarize(openrouterKey, title, date, capped)
  if (!summaryText) return

  // Insert into Supabase
  const inserted = await insertSummary(supabaseUrl, serviceRoleKey, userId, summaryText)
  if (!inserted) return

  // Mark session as done
  sessions[session_id] = new Date().toISOString()
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const SYSTEM_PROMPT = `You are a memory assistant. You are given a Claude Code session transcript between a developer and an AI coding assistant.

Your job is to extract a detailed, durable memory summary that will help understand this developer's work and preferences.

Start with a header line exactly like this:
### [YYYY-MM-DD] Session Title
Then bullet the key facts underneath.

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

async function summarize(openrouterKey, title, date, messages) {
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
        model: "meta-llama/llama-3.3-70b-instruct:free",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input }
        ],
        temperature: 0.3,
        max_tokens: 700
      }),
      signal: AbortSignal.timeout(30_000)
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

async function insertSummary(supabaseUrl, serviceRoleKey, userId, content) {
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

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(() => {}).finally(() => process.exit(0))
