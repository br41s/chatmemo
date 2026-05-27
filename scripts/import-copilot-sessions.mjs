#!/usr/bin/env node
/**
 * Bulk importer for historical GitHub Copilot Chat sessions.
 *
 * Scans all VS Code workspaceStorage/{hash}/chatSessions/*.jsonl files, skips
 * sessions already imported (tracked in ~/.chatmemo/imported-sessions.json),
 * summarises each one via OpenRouter, and inserts it into Supabase.
 *
 * Usage:
 *   node scripts/import-copilot-sessions.mjs
 *   npm run import:copilot
 *
 * Config:  ~/.chatmemo/config.json          (created by chatmemo-hook-setup.mjs)
 * Tracks:  ~/.chatmemo/imported-sessions.json
 */

import {
  MIN_USER_MESSAGES,
  MAX_MESSAGES,
  loadConfig,
  loadSessions,
  saveSessionsFile,
  mtimeToDate,
  sleep,
  summarize,
  insertSummary
} from "./claude-sessions-shared.mjs"
import { findCopilotJSONLFiles, parseCopilotJSONL } from "./copilot-sessions-shared.mjs"

/** Delay between API calls to avoid rate-limiting (ms). */
const DELAY_BETWEEN_CALLS_MS = 8_000

async function main() {
  const { supabaseUrl, serviceRoleKey, openrouterKey, userId } = loadConfig()
  const sessions = loadSessions()

  const allFiles = findCopilotJSONLFiles()
  console.log(`Found ${allFiles.length} Copilot session files in VS Code workspaceStorage`)

  const toProcess = allFiles.filter(f => !sessions[`copilot:${f.sessionId}`])
  console.log(
    `${toProcess.length} not yet imported (${allFiles.length - toProcess.length} already done)\n`
  )

  if (toProcess.length === 0) {
    console.log("Nothing to import.")
    return
  }

  let imported = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < toProcess.length; i++) {
    const { path: filePath, sessionId, projectName, mtime } = toProcess[i]
    const num = `[${i + 1}/${toProcess.length}]`

    const messages = parseCopilotJSONL(filePath)
    const userMessages = messages.filter(m => m.role === "user")

    if (userMessages.length < MIN_USER_MESSAGES) {
      console.log(
        `${num} SKIP  ${sessionId.slice(0, 8)}… (${userMessages.length} user msgs — too short)`
      )
      sessions[`copilot:${sessionId}`] = "skipped:" + new Date().toISOString()
      saveSessionsFile(sessions)
      skipped++
      continue
    }

    const capped = messages.slice(-MAX_MESSAGES)
    const date = mtimeToDate(mtime)
    const title = `[Copilot] ${projectName} — ${date}`

    process.stdout.write(
      `${num} ${sessionId.slice(0, 8)}… "${projectName}" (${userMessages.length} msgs) → `
    )

    const factsText = await summarize(openrouterKey, title, date, capped)
    if (!factsText) {
      console.log("SKIP (LLM failed — will retry next run)")
      // Do NOT save — retry on next run
      failed++
    } else {
      const summaryText = `### [${date}] ${projectName} [Copilot]\n\n${factsText}`
      const ok = await insertSummary(supabaseUrl, serviceRoleKey, userId, summaryText)
      if (ok) {
        console.log("✓ imported")
        sessions[`copilot:${sessionId}`] = new Date().toISOString()
        imported++
      } else {
        console.log("✗ insert failed")
        failed++
      }
      saveSessionsFile(sessions)
    }

    if (i < toProcess.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS)
    }
  }

  console.log(
    `\nDone. Imported: ${imported} | Skipped: ${skipped} | Failed: ${failed}`
  )
}

main().catch(err => {
  console.error("Fatal error:", err.message)
  process.exit(1)
})
