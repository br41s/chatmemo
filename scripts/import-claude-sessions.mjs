#!/usr/bin/env node
/**
 * Bulk importer for historical Claude Code sessions.
 *
 * Scans all ~/.claude/projects/**\/*.jsonl files, skips sessions already
 * imported (tracked in ~/.chatmemo/imported-sessions.json), and posts each
 * one to ChatMemo, which summarises it and stores it.
 *
 * Usage:
 *   node scripts/import-claude-sessions.mjs
 *   npm run import:claude
 *
 * Config:  ~/.chatmemo/config.json          (created by chatmemo-hook-setup.mjs)
 * Tracks:  ~/.chatmemo/imported-sessions.json
 */

import {
  CLAUDE_PROJECTS_DIR,
  loadConfig,
  loadSessions,
  findAllJSONLFiles,
  parseJSONL,
  slugToProjectName,
  sleep,
  syncSession,
  transcriptCwd
} from "./claude-sessions-shared.mjs"

/** Delay between posts, so the server's summariser is not rate-limited (ms). */
const DELAY_BETWEEN_CALLS_MS = 8_000

async function main() {
  const config = loadConfig()
  const sessions = loadSessions()

  const allFiles = findAllJSONLFiles(CLAUDE_PROJECTS_DIR)
  console.log(`Found ${allFiles.length} session files in ~/.claude/projects/`)

  const toProcess = allFiles.filter(f => !sessions[f.sessionId])
  console.log(
    `${toProcess.length} not yet imported (${allFiles.length - toProcess.length} already done)\n`
  )

  if (toProcess.length === 0) {
    console.log("Nothing to import.")
    return
  }

  const counts = { synced: 0, skipped: 0, excluded: 0, failed: 0, busy: 0 }

  for (let i = 0; i < toProcess.length; i++) {
    const { path: filePath, sessionId, projectSlug, mtime } = toProcess[i]
    const projectName = slugToProjectName(projectSlug)
    process.stdout.write(
      `[${i + 1}/${toProcess.length}] ${sessionId.slice(0, 8)}… "${projectName}" → `
    )

    const outcome = await syncSession({
      config,
      key: sessionId,
      messages: parseJSONL(filePath),
      mtime,
      title: `[Claude Code] ${projectName}`,
      project: { cwd: transcriptCwd(filePath), projectSlug },
      final: true,
      log: message => console.log(message)
    })
    counts[outcome] = (counts[outcome] ?? 0) + 1

    if (outcome === "synced" && i < toProcess.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS)
    }
  }

  console.log(
    `\nDone. Synced: ${counts.synced} | Too short: ${counts.skipped} | Excluded: ${counts.excluded} | Failed (will retry): ${counts.failed}`
  )
}

main().catch(err => {
  console.error("Fatal error:", err.message)
  process.exit(1)
})
