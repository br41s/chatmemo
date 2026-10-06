#!/usr/bin/env node
/**
 * One-off: move Claude Code sessions stored as `claude` to `claude_code`.
 *
 * Run after 20261001000000_summaries_claude_code_source.sql. That migration
 * moves every row whose content, or external_id, says it is a session. What is
 * left are sessions the laptop sync wrote before it tagged them as such: their
 * content reads `[source:claude]\n### [date] project`, exactly like a Claude.ai
 * import. Two things still tell them apart, and neither is in the database:
 *
 *   1. The sync's own record. ~/.chatmemo/imported-sessions.json names the row
 *      each session was stored in. Certain.
 *   2. The title. The sync titles a row with the project's folder name — one
 *      word, `biglobster` — and before 2026-09-29 wrote it with no tag at all.
 *      A Claude.ai conversation titled with a single word would look the same,
 *      so this one is a judgement, and is only applied when asked for.
 *
 * Only `source` changes. Content is left as it is: a backup restores by exact
 * content, and a rewritten row would come back as a duplicate.
 *
 * Usage:
 *   node scripts/backfill-claude-code-source.mjs                 # report only
 *   node scripts/backfill-claude-code-source.mjs --apply         # rule 1
 *   node scripts/backfill-claude-code-source.mjs --apply --by-title   # 1 and 2
 */

import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import { loadSessions } from "./claude-sessions-shared.mjs"

// The service-role key is not kept on the laptop any more; this one-off reads
// it from the project's .env.local, together with the owner's id, and holds
// it only while it runs.
function loadConfig() {
  const envPath = resolve(".env.local")
  if (!existsSync(envPath)) {
    console.error("✗ .env.local not found. Run from the chatmemo project root.")
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const userId = env.CHATMEMO_IMPORT_USER_ID
  if (!supabaseUrl || !serviceRoleKey || !userId) {
    console.error(
      "✗ .env.local needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CHATMEMO_IMPORT_USER_ID"
    )
    process.exit(1)
  }
  return { supabaseUrl, serviceRoleKey, userId }
}

const APPLY = process.argv.includes("--apply")
const BY_TITLE = process.argv.includes("--by-title")

const PAGE = 1000 // PostgREST's own ceiling per request
const UPDATE_BATCH = 100 // ids per PATCH, to keep the URL short

/** A folder name: one word, as the sync writes it. */
const PROJECT_TITLE_RE = /^[\w.-]+$/
/** `### [date] title` and nothing else that looks like a header. */
const BRACKETED_HEADER_RE = /^###\s+\[\d{4}-\d{2}-\d{2}\]/gm

function headers(serviceRoleKey) {
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  }
}

async function fetchClaudeRows({ supabaseUrl, serviceRoleKey, userId }) {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `${supabaseUrl}/rest/v1/summaries?select=id,title,content,external_id` +
      `&user_id=eq.${userId}&source=eq.claude` +
      `&kind=in.(conversation,summary)&order=id&limit=${PAGE}&offset=${offset}`
    const res = await fetch(url, { headers: headers(serviceRoleKey) })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function setSource({ supabaseUrl, serviceRoleKey, userId }, ids) {
  let updated = 0
  for (let i = 0; i < ids.length; i += UPDATE_BATCH) {
    const batch = ids.slice(i, i + UPDATE_BATCH)
    // source=eq.claude again: a row that changed since it was read is left.
    const url =
      `${supabaseUrl}/rest/v1/summaries?id=in.(${batch.join(",")})` +
      `&user_id=eq.${userId}&source=eq.claude`
    const res = await fetch(url, {
      method: "PATCH",
      headers: { ...headers(serviceRoleKey), Prefer: "return=representation" },
      body: JSON.stringify({ source: "claude_code" })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
    updated += (await res.json()).length
  }
  return updated
}

function titleCounts(rows) {
  const counts = new Map()
  for (const row of rows) {
    const title = (row.title ?? "").slice(0, 50)
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

async function main() {
  const config = loadConfig()

  // Copilot sessions share the file under `copilot:` keys. They are not
  // Claude Code.
  const syncedRowIds = new Set(
    Object.entries(loadSessions())
      .filter(([key, entry]) => !key.startsWith("copilot:") && entry?.rowId)
      .map(([, entry]) => entry.rowId)
  )

  const rows = await fetchClaudeRows(config)

  // A cloud session posted while the old route was still deployed was stored
  // as "claude" with its key; the migration's backfill ran before it existed.
  const isCloudSession = row =>
    (row.external_id ?? "").startsWith("claude-code:") &&
    !(row.content ?? "").startsWith("[source:")

  const byRecord = rows.filter(
    row => syncedRowIds.has(row.id) || isCloudSession(row)
  )
  const byTitle = rows.filter(row => {
    if (syncedRowIds.has(row.id) || isCloudSession(row)) return false
    const content = row.content ?? ""
    return (
      !content.startsWith("[source:") &&
      /^\s*###\s+\[/.test(content) &&
      (content.match(BRACKETED_HEADER_RE) ?? []).length === 1 &&
      PROJECT_TITLE_RE.test(row.title ?? "")
    )
  })

  console.log(`${rows.length} rows are stored as "claude".`)
  console.log(
    `\n1. Named by the sync's own record, or a cloud session's key: ` +
      `${byRecord.length} (${syncedRowIds.size} recorded by the sync)`
  )
  console.log(
    `\n2. Untagged, one header, titled like a project: ${byTitle.length}`
  )
  for (const [title, count] of titleCounts(byTitle)) {
    console.log(`   ${String(count).padStart(3)} × ${title}`)
  }

  if (!APPLY) {
    console.log(
      "\nNothing changed. --apply moves group 1; add --by-title for group 2."
    )
    return
  }

  const ids = [...byRecord, ...(BY_TITLE ? byTitle : [])].map(row => row.id)
  const updated = await setSource(config, ids)
  console.log(`\nMoved ${updated} of ${ids.length} rows to "claude_code".`)
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
