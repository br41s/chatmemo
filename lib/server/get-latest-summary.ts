import { MEMORY_ORDER_COLUMN } from "@/lib/summary-metadata"
import { createClient } from "@/lib/supabase/server"
import { getLessons } from "@/lib/db/lessons"
import { fillLayer } from "@/lib/server/cut-to-fit"
import { VersionedCache } from "@/lib/server/versioned-cache"
import { ContextBudget, resolveContextBudget } from "@/lib/context-budget"
import { cookies } from "next/headers"

// ---------------------------------------------------------------------------
// Memory budget
//
// "Personal" rows are all Claude-origin content: Claude Code sessions,
// VS Code sync hook, bookmarklet entries, Claude bulk import LLM summaries,
// and in-app chat summaries. These are already compact (~400–1 500 chars).
//
// IMPORTANT: [source:claude] rows ARE personal rows. We only exclude
// [source:perplexity] and [source:chatgpt] from query A — NOT [source:claude].
// That was the root bug: Claude Code sessions were invisible to both queries.
//
// "Bulk" rows are Perplexity and ChatGPT imports. Raw conversations can be
// 10 k chars; we cap them at 400 chars for topic awareness. LLM summaries
// generated at import time (compact, <800 chars) are also stored with the
// same source tag and are fully included under the 400-char cap.
//
// Sizes come from the turn's context budget (lib/context-budget.ts): on a
// large window the layers below reach their previous fixed sizes, on a small
// one they shrink together so the block fits.
// ---------------------------------------------------------------------------

const PERSONAL_ROW_MAX = 1_500 // cap per personal row
const BULK_ROW_MAX = 400 // title + opening line only for bulk rows

export const MAX_PERSONAL_ROWS = 150 // enough to cover all personal sessions
export const MAX_BULK_ROWS = 30 // only recent bulk rows are useful
export const MAX_INDEX_ROWS = 5

// Per-row cap for index rows. They are date lists, so truncation costs the
// oldest entries in that row rather than corrupting anything — but without a
// cap one legitimately-large index (a bulk import can produce 58k chars of
// them) crowds out every actual conversation.
const INDEX_ROW_MAX = 4_000

function cap(content: string, max: number): string {
  return content.length > max ? content.slice(0, max) + "…" : content
}

/**
 * Returns memory content to inject into the system prompt.
 *
 * Fetches the lessons document alongside three parallel row queries, then hands
 * everything to buildSummarySections. Lessons are a separate memory layer from
 * conversation history — either one alone is worth injecting.
 *
 * The three row queries:
 *   A. Personal rows — everything EXCEPT [source:perplexity], [source:chatgpt],
 *      watermarks, and index rows. This includes [source:claude] rows (Claude
 *      Code sessions, bookmarklet, bulk import LLM summaries) AND untagged
 *      rows (old in-app chat summaries). Limit 150, budget 80 k chars.
 *   B. Bulk rows — Perplexity + ChatGPT only. Raw text capped at 400 chars;
 *      LLM summaries (if present) also fit under 400 chars. Limit 30.
 *   C. Index rows — compact conversation date lists.
 */
// Keyed by user, versioned by the state of their memory. Module scope, so a
// warm server instance reuses it across requests; a cold one simply misses.
// Bounded because a shared instance must not grow with the number of users it
// happens to serve.
const baselineCache = new VersionedCache<string | null>(50)

/**
 * A token that changes whenever anything the baseline blob is built from
 * changes: a summary inserted, a summary deleted, or the lessons document
 * rewritten.
 *
 * Count matters as much as the newest timestamp — deleting an older row from
 * the memory panel leaves the newest one untouched, and versioning on the
 * timestamp alone would keep serving the deleted content. PostgREST returns
 * the exact count alongside the row, so this stays two small queries.
 */
async function readMemoryVersion(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const [summaries, lessons] = await Promise.all([
    supabase
      .from("summaries")
      .select("created_at", { count: "exact" })
      .eq("user_id", userId)
      // `created_at`, not the effective date the row queries order by: this
      // asks "has anything been written since the blob was built", which is a
      // question about insertion. A row imported today carrying a 2024
      // conversation date must still invalidate the cache.
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("user_lessons")
      .select("updated_at")
      .eq("user_id", userId)
      .maybeSingle()
  ])

  const newest = summaries.data?.[0]?.created_at ?? "none"
  const count = summaries.count ?? -1
  const lessonsAt = lessons.data?.updated_at ?? "none"

  return `${count}|${newest}|${lessonsAt}`
}

export async function getLatestSummaryForUser(
  userId: string,
  budget: ContextBudget = resolveContextBudget()
): Promise<string | null> {
  const supabase = createClient(await cookies())

  // The budget is part of the cache key, not just the query: the same rows
  // assembled under a different allowance are a different blob, so switching
  // to a smaller-window model must not serve the larger model's block.
  const version = `${await readMemoryVersion(supabase, userId)}|${budget.lessonsChars}|${budget.personalChars}|${budget.bulkChars}|${budget.indexChars}`
  const cached = baselineCache.get(userId, version)
  // A cached null is a real answer — "this user has no memory yet" is worth
  // not recomputing — so only undefined counts as a miss.
  if (cached !== undefined) return cached

  const [personalResult, bulkResult, indexResult, lessons] = await Promise.all([
    // A. Personal: everything narrative except raw Perplexity/ChatGPT imports.
    //    [source:claude] rows ARE included — they are Claude Code sessions, and
    //    so are the import-time LLM summaries of bulk sources: the old
    //    `[source:chatgpt]%` predicate did not match `[source:chatgpt:summary]`,
    //    so those landed here, under the 1 500-char cap rather than the 400-char
    //    bulk one. Keeping them here preserves that.
    //
    //    The source list is positive rather than a negation because the CHECK
    //    constraint added with these columns closes the set to exactly four
    //    values, so (claude, other) is the complement of (perplexity, chatgpt).
    supabase
      .from("summaries")
      .select("id, content, effective_at")
      .eq("user_id", userId)
      .in("kind", ["conversation", "summary"])
      .or("kind.eq.summary,source.in.(claude,other)")
      .order(MEMORY_ORDER_COLUMN, { ascending: false })
      .limit(MAX_PERSONAL_ROWS),

    // B. Bulk imports: raw Perplexity + ChatGPT conversations, title-only when
    //    building context. Their LLM summaries are kind "summary" and belong to
    //    query A, which is where the previous predicates put them.
    supabase
      .from("summaries")
      .select("id, content, effective_at")
      .eq("user_id", userId)
      .eq("kind", "conversation")
      .in("source", ["perplexity", "chatgpt"])
      .order(MEMORY_ORDER_COLUMN, { ascending: false })
      .limit(MAX_BULK_ROWS),

    // C. Index rows
    supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .eq("kind", "index")
      .order(MEMORY_ORDER_COLUMN, { ascending: false })
      .limit(MAX_INDEX_ROWS),

    // Lessons (separate from conversation history) — fetched in the same
    // round-trip batch instead of serially after the three queries above.
    getLessons(supabase, userId)
  ])

  const sections = buildSummarySections(
    lessons,
    indexResult.data ?? [],
    personalResult.data ?? [],
    bulkResult.data ?? [],
    budget
  )

  baselineCache.set(userId, version, sections)

  return sections
}

/** Test seam — lets a suite start from a known-cold cache. */
export function __clearBaselineCache(): void {
  baselineCache.clear()
}

interface SummaryRow {
  content: string | null
  /** When the conversation happened (or the row was written). */
  effective_at?: string | null
}

// The header may follow a `[source:X]` tag on the same line.
// Bracketed or not — the old Stop hook wrote `### 2026-09-27 Title`.
const DATE_HEADER_RE =
  /^\s*(\[source:[\w:]+\]\s*)?###\s+(\[\d{4}-\d{2}-\d{2}\]|\d{4}-\d{2}-\d{2}\b)/m

/**
 * A row's content, dated.
 *
 * Imported and Claude Code rows open with a `### [YYYY-MM-DD]` header; in-app
 * chat summaries do not — their text is only what the summariser wrote. Without
 * a date the model cannot tell yesterday's conversation from May's, and "what
 * did we talk about yesterday" was answered with "nothing stored". Rows that
 * already state a date keep it.
 */
export function withDateHeader(content: string, effectiveAt?: string | null) {
  if (!effectiveAt || DATE_HEADER_RE.test(content)) return content
  const date = effectiveAt.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `### [${date}]\n${content}`
    : content
}

const LESSONS_CUT_NOTE =
  "[…some lessons were left out of each section to fit this model's context window]"

/** A `## ` heading line, which is how the rewrite prompt structures the
 *  document: Preferences, Active Projects, Personal Context, Recurring
 *  Patterns & Constraints, in that order. */
const SECTION_RE = /^## /m

interface LessonsSection {
  /** The heading line, or null for whatever precedes the first heading. */
  heading: string | null
  lines: string[]
}

function splitSections(text: string): LessonsSection[] {
  const sections: LessonsSection[] = []
  let current: LessonsSection = { heading: null, lines: [] }
  for (const line of text.split("\n")) {
    if (SECTION_RE.test(line)) {
      sections.push(current)
      current = { heading: line, lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)
  return sections.filter(
    section => section.heading !== null || section.lines.some(l => l.trim())
  )
}

/**
 * Divide `total` among sections that each want `wants[i]`: every section
 * gets what it wants until the money runs out, and the ones that want more
 * than an even share split what is left evenly. A short section is kept
 * whole; the long ones are cut alike.
 */
function shareOut(wants: number[], total: number): number[] {
  const shares = wants.map(() => 0)
  let remaining = Math.max(total, 0)
  let open = wants.map((_, i) => i)
  while (open.length > 0 && remaining > 0) {
    const each = Math.floor(remaining / open.length)
    const satisfied = open.filter(i => wants[i] <= each)
    if (satisfied.length === 0) {
      for (const i of open) shares[i] = each
      break
    }
    for (const i of satisfied) {
      shares[i] = wants[i]
      remaining -= wants[i]
    }
    open = open.filter(i => !satisfied.includes(i))
  }
  return shares
}

/** The first whole lines of `lines` that fit in `room`, joined. */
function headOf(lines: string[], room: number): string {
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? 1 : 0)
    if (used + cost > room) break
    kept.push(line)
    used += cost
  }
  return kept.join("\n").trimEnd()
}

/**
 * The lessons document, within its allowance.
 *
 * It used to go in whole whatever its size. On a window with room it still
 * does — the allowance there is above what the rewrite lets the document
 * reach. On a small one it is cut, and says so: the model is told to read
 * lessons first, so it should know when it has not been given all of them.
 *
 * Cut by section, not from the end. The document is four sections in a
 * fixed order, so cutting from the end lost "Recurring Patterns &
 * Constraints" — the hard requirements — whole, while keeping every
 * preference. Each section keeps its heading and its first lines; short
 * sections stay whole and the long ones give up the same amount. Null when
 * not even a line would fit.
 */
export function fitLessons(lessons: string, maxChars: number): string | null {
  const text = lessons.trim()
  if (!text) return null
  if (text.length <= maxChars) return text

  const room = maxChars - LESSONS_CUT_NOTE.length - 1
  if (room <= 0) return null

  const sections = splitSections(text)
  // What the headings and the blank lines between sections cost regardless.
  const fixed = sections.reduce(
    (sum, s) => sum + (s.heading ? s.heading.length + 1 : 0),
    sections.length - 1
  )
  const bodies = sections.map(s => s.lines.join("\n").trimEnd())
  const shares = shareOut(
    bodies.map(b => b.length),
    room - fixed
  )
  const kept = sections.map((s, i) => {
    const body = headOf(s.lines, shares[i])
    return s.heading ? (body ? `${s.heading}\n${body}` : s.heading) : body
  })
  const anyBody = sections.some((s, i) => headOf(s.lines, shares[i]).length > 0)
  if (!anyBody) return null

  const out = kept.filter(Boolean).join("\n\n")
  return `${out}\n${LESSONS_CUT_NOTE}`
}

/**
 * Assemble the injectable memory sections from already-fetched rows.
 *
 * Lessons and conversation history are INDEPENDENT layers: a user with a
 * populated lessons document but no summary rows — or one who cleared their
 * summaries from the memory panel — must still get their lessons. This used to
 * bail out early on `personalData.length === 0 && bulkData.length === 0`,
 * which discarded lessons that had already been fetched successfully, while
 * the instructions block kept telling the model [LESSONS] was the highest
 * quality signal and to read it first.
 *
 * Returning null is decided at the end instead, where it means what it says:
 * nothing at all to inject.
 *
 * Pure + exported so the budgets and the layer independence can be unit-tested
 * without a database.
 */
export function buildSummarySections(
  lessons: string | null,
  indexData: SummaryRow[],
  personalData: SummaryRow[],
  bulkData: SummaryRow[],
  budget: ContextBudget = resolveContextBudget()
): string | null {
  const present = (rows: SummaryRow[]) =>
    rows
      .map(row => ({ row, content: (row.content ?? "").trim() }))
      .filter(({ content }) => content)

  const parts: string[] = [
    // 1. Index rows — compact date lists, high-value for history questions,
    //    but capped and budgeted like every other layer. They used to be
    //    pushed whole and counted against nothing, on the assumption they
    //    were tiny.
    ...fillLayer(
      present(indexData.slice(0, MAX_INDEX_ROWS)).map(({ content }) =>
        cap(content, INDEX_ROW_MAX)
      ),
      budget.indexChars
    ),
    // 2. Personal rows — compact summaries, large budget
    ...fillLayer(
      present(personalData).map(({ row, content }) =>
        withDateHeader(cap(content, PERSONAL_ROW_MAX), row.effective_at)
      ),
      budget.personalChars
    ),
    // 3. Bulk rows — topic excerpts only
    ...fillLayer(
      present(bulkData).map(({ row, content }) =>
        withDateHeader(cap(content, BULK_ROW_MAX), row.effective_at)
      ),
      budget.bulkChars
    )
  ]

  const sections: string[] = []

  const fittedLessons = lessons
    ? fitLessons(lessons, budget.lessonsChars)
    : null
  if (fittedLessons) {
    sections.push(
      `[LESSONS — Accumulated knowledge about you from past sessions]\n${fittedLessons}\n[/LESSONS]`
    )
  }

  if (parts.length > 0) {
    sections.push(
      `[CONVERSATION HISTORY — newest entries first]\n${parts.join("\n\n---\n\n")}\n[/CONVERSATION HISTORY]`
    )
  }

  return sections.length > 0 ? sections.join("\n\n") : null
}
