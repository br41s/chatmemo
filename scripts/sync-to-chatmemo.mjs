#!/usr/bin/env node
/**
 * Claude Code Stop / SessionEnd hook — syncs the current session to ChatMemo.
 *
 * Registered in ~/.claude/settings.json by scripts/chatmemo-hook-setup.mjs.
 * Reads config from ~/.chatmemo/config.json (created by setup script): the
 * import token and the deployment URL. The session is posted to ChatMemo,
 * which summarises and stores it; nothing on the laptop can reach the
 * database.
 *
 * Behaviour:
 *  - Stop fires after every turn; SessionEnd once when the session closes
 *  - A session is summarised once it has MIN_USER_MESSAGES, again every
 *    RESYNC_GROWTH user messages after that, and a last time at SessionEnd.
 *    Each new summary replaces the session's previous row.
 *  - The work runs in a detached child, so Claude Code never waits on the
 *    summariser
 *  - Every outcome, failures included, goes to ~/.chatmemo/sync.log
 *  - Always exits 0 so it never blocks Claude Code
 */

import { spawn } from "child_process"
import { statSync } from "fs"
import { fileURLToPath } from "url"
import {
  appendSyncLog,
  parseJSONL,
  readConfig,
  syncSession
} from "./claude-sessions-shared.mjs"

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
    return // malformed input — silent exit
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
    [fileURLToPath(import.meta.url), "--worker", payload],
    {
      detached: true,
      stdio: "ignore"
    }
  ).unref()
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

async function work({ transcript_path, session_id, cwd = "", event }) {
  if (!transcript_path || !session_id) return

  const { config, error } = readConfig()
  if (!config) {
    appendSyncLog(`${session_id}: ${error}`)
    return
  }

  let mtime
  try {
    mtime = statSync(transcript_path).mtime.getTime()
  } catch (e) {
    appendSyncLog(`${session_id}: transcript unreadable — ${e.message}`)
    return
  }

  const messages = parseJSONL(transcript_path)
  const projectName = cwd.split("/").filter(Boolean).pop() || "Claude Code"

  await syncSession({
    config,
    key: session_id,
    messages,
    mtime,
    title: `[Claude Code] ${projectName}`,
    project: { cwd },
    final: event === "SessionEnd"
  })
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main()
  .catch(e => appendSyncLog(`hook error: ${e?.message || e}`))
  .finally(() => process.exit(0))
