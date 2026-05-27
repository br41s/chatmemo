/**
 * Shared utilities for GitHub Copilot Chat session scripts:
 *   - import-copilot-sessions.mjs  (bulk historical import)
 *   - watch-claude-sessions.mjs    (background daemon, copilot block)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { homedir } from "os"
import { join, basename } from "path"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = homedir()
const VSCODE_WORKSPACE_STORAGE = join(
  HOME,
  "Library",
  "Application Support",
  "Code",
  "User",
  "workspaceStorage"
)

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Scan all VS Code workspaceStorage/{hash}/chatSessions/*.jsonl files.
 *
 * @returns Array of { path, sessionId, projectName, mtime }
 *   - sessionId:   filename without .jsonl
 *   - projectName: basename of the workspace folder from workspace.json;
 *                  falls back to the first 8 chars of the hash if unreadable
 *   - mtime:       file modification time in ms
 */
export function findCopilotJSONLFiles() {
  if (!existsSync(VSCODE_WORKSPACE_STORAGE)) return []

  const results = []

  for (const hash of readdirSync(VSCODE_WORKSPACE_STORAGE)) {
    const chatSessionsDir = join(VSCODE_WORKSPACE_STORAGE, hash, "chatSessions")
    try {
      if (!statSync(chatSessionsDir).isDirectory()) continue
    } catch {
      continue
    }

    // Resolve project name from workspace.json
    let projectName = hash.slice(0, 8) // fallback: hash prefix
    const workspaceJsonPath = join(VSCODE_WORKSPACE_STORAGE, hash, "workspace.json")
    try {
      const wj = JSON.parse(readFileSync(workspaceJsonPath, "utf8"))
      // folder is a URI like "file:///Users/brais/VSCODE/chatmemo"
      if (wj.folder) {
        const decoded = decodeURIComponent(wj.folder.replace(/^file:\/\//, ""))
        const name = basename(decoded)
        if (name) projectName = name
      }
    } catch {
      // keep fallback
    }

    let files
    try {
      files = readdirSync(chatSessionsDir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue
      const sessionId = file.replace(".jsonl", "")
      const filePath = join(chatSessionsDir, file)
      let mtime = 0
      try {
        mtime = statSync(filePath).mtime.getTime()
      } catch {
        continue
      }
      results.push({ path: filePath, sessionId, projectName, mtime })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Copilot Chat JSONL session file.
 *
 * Finds the last kind=2 entry (most up-to-date snapshot), or falls back to
 * kind=0 (initial state). Extracts each turn as user + assistant messages.
 *
 * @returns Array of { role: "user" | "assistant", text: string }
 */
export function parseCopilotJSONL(filePath) {
  let lines
  try {
    lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean)
  } catch {
    return []
  }

  // Build a merged, ordered map of requestId → request.
  //
  // kind=0 holds the initial checkpoint (complete turns with full responses).
  // kind=2 with k=["requests"] adds one new turn per entry as the session grows.
  // These two sets never overlap, so we can safely merge them in order.
  // All other kind=2 entries (streaming response patches) are ignored here
  // because the response text is already present in the k=["requests"] entry
  // once a turn completes.
  const requestsMap = new Map()

  for (const line of lines) {
    try {
      const d = JSON.parse(line)
      if (d.kind === 0) {
        for (const req of (d.v?.requests ?? [])) {
          if (req?.requestId) requestsMap.set(req.requestId, req)
        }
      } else if (
        d.kind === 2 &&
        Array.isArray(d.k) &&
        d.k.length === 1 &&
        d.k[0] === "requests"
      ) {
        for (const req of (Array.isArray(d.v) ? d.v : [])) {
          if (req?.requestId) requestsMap.set(req.requestId, req)
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  const requests = Array.from(requestsMap.values())
  const messages = []

  for (const req of requests) {
    const userText = (req.message?.text ?? "").trim()

    // Join non-thinking response parts
    const responseText = (req.response ?? [])
      .filter(
        r =>
          r !== null &&
          typeof r === "object" &&
          r.kind !== "thinking" &&
          typeof r.value === "string"
      )
      .map(r => r.value)
      .join("\n")
      .trim()

    // Skip turns where both sides are empty/too short
    if (userText.length < 15 && responseText.length < 15) continue

    if (userText.length >= 15) {
      messages.push({ role: "user", text: userText })
    }
    if (responseText.length >= 15) {
      messages.push({ role: "assistant", text: responseText })
    }
  }

  return messages
}
