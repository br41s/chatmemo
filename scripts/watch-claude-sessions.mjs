#!/usr/bin/env node
/**
 * Auto-sync daemon for Claude Code sessions (macOS app + any other source).
 *
 * Polls ~/.claude/projects/ every POLL_INTERVAL_MS for new session files.
 * A session is considered "complete" when its file hasn't been modified for
 * IDLE_THRESHOLD_MS — this prevents importing an actively-running session.
 *
 * This covers the macOS Claude Code app, which does not fire the Stop hook.
 *
 * Usage:
 *   node scripts/watch-claude-sessions.mjs          # run in foreground
 *   npm run watch:claude
 *
 * Background daemon (macOS LaunchAgent):
 *   npm run watch:claude:install
 *   launchctl load ~/Library/LaunchAgents/com.chatmemo.watch-claude-sessions.plist
 *
 * Config:  ~/.chatmemo/config.json
 * Tracks:  ~/.chatmemo/imported-sessions.json
 * Logs:    ~/.chatmemo/watch.log  (via LaunchAgent StandardOutPath)
 */

import { mkdirSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import {
  CLAUDE_PROJECTS_DIR,
  appendSyncLog,
  findAllJSONLFiles,
  hasChangedSince,
  loadConfig,
  loadSessions,
  parseJSONL,
  slugToProjectName,
  sleep,
  syncSession
} from "./claude-sessions-shared.mjs"
import {
  findCopilotJSONLFiles,
  parseCopilotJSONL
} from "./copilot-sessions-shared.mjs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOME = homedir()
const LAUNCHAGENT_LABEL = "com.chatmemo.watch-claude-sessions"
const LAUNCHAGENT_DIR = join(HOME, "Library", "LaunchAgents")
const LAUNCHAGENT_PLIST = join(LAUNCHAGENT_DIR, `${LAUNCHAGENT_LABEL}.plist`)
const LOG_FILE = join(HOME, ".chatmemo", "watch.log")

/** How often to scan for new sessions. */
const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * A session file must be idle for this long before we consider it "done".
 * Prevents importing an actively-running session.
 */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ")
  console.log(`[${ts}] ${msg}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--install")) {
    installLaunchAgent()
    return
  }

  if (args.includes("--uninstall")) {
    printUninstallInstructions()
    return
  }

  const config = loadConfig()

  log("ChatMemo session watcher started")
  log(
    `Polling every ${POLL_INTERVAL_MS / 60000} min | Idle threshold: ${IDLE_THRESHOLD_MS / 60000} min`
  )

  await poll(config)
  setInterval(() => poll(config), POLL_INTERVAL_MS)

  process.on("SIGINT", () => {
    log("Watcher stopped (SIGINT)")
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    log("Watcher stopped (SIGTERM)")
    process.exit(0)
  })
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

async function poll(config) {
  const now = Date.now()
  const sessions = loadSessions()

  // Idle sessions that are new, or have changed since they were last synced.
  // A synced session that grew is summarised again and its row replaced.
  const candidates = [
    ...findAllJSONLFiles(CLAUDE_PROJECTS_DIR).map(f => ({
      ...f,
      key: f.sessionId,
      label: slugToProjectName(f.projectSlug),
      parse: parseJSONL,
      title: name => `[Claude Code] ${name}`,
      header: (date, name) => `[source:claude_code]\n### [${date}] ${name}`
    })),
    ...findCopilotJSONLFiles().map(f => ({
      ...f,
      key: `copilot:${f.sessionId}`,
      label: f.projectName,
      parse: parseCopilotJSONL,
      title: name => `[Copilot] ${name}`,
      header: (date, name) => `### [${date}] ${name} [Copilot]`
    }))
  ].filter(
    f =>
      now - f.mtime >= IDLE_THRESHOLD_MS &&
      hasChangedSince(sessions[f.key], f.mtime)
  )

  if (candidates.length > 0) {
    log(`Found ${candidates.length} session(s) to check`)
  }

  for (const f of candidates) {
    const outcome = await syncSession({
      config,
      key: f.key,
      messages: f.parse(f.path),
      mtime: f.mtime,
      title: f.title(f.label),
      header: date => f.header(date, f.label),
      // Idle this long counts as finished; a later resume re-syncs it.
      final: true,
      log: message => {
        log(message)
        appendSyncLog(message)
      }
    })

    if (outcome === "inserted" || outcome === "replaced") await sleep(2_000)
  }
}

// ---------------------------------------------------------------------------
// LaunchAgent installer (macOS)
// ---------------------------------------------------------------------------

function installLaunchAgent() {
  const scriptPath = new URL(import.meta.url).pathname
  const nodePath = process.execPath

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHAGENT_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>

  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>`

  try {
    mkdirSync(LAUNCHAGENT_DIR, { recursive: true })
    writeFileSync(LAUNCHAGENT_PLIST, plist)
    console.log(`LaunchAgent written to: ${LAUNCHAGENT_PLIST}`)
    console.log("")
    console.log("To activate now, run:")
    console.log(`  launchctl load ${LAUNCHAGENT_PLIST}`)
    console.log("")
    console.log("It will also start automatically at login.")
    console.log("")
    console.log("To check status:  launchctl list | grep chatmemo")
    console.log(`To view logs:     tail -f ${LOG_FILE}`)
  } catch (e) {
    console.error("Failed to write LaunchAgent:", e.message)
    process.exit(1)
  }
}

function printUninstallInstructions() {
  console.log("To uninstall the LaunchAgent, run:")
  console.log(`  launchctl unload "${LAUNCHAGENT_PLIST}"`)
  console.log(`  rm "${LAUNCHAGENT_PLIST}"`)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  log(`Fatal error: ${err.message}`)
  process.exit(1)
})
