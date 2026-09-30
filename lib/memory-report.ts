// What the server actually told the model about the user, reported back to the
// browser so the answer can say where it came from.
//
// The product's whole premise is persistent memory, and until now the chat
// surface said nothing about it: no indication that memory was injected, no
// view of what was injected, no way to tell an answer grounded in a stored
// conversation from one the model made up. The injected instructions spend a
// long paragraph telling the model not to fabricate; this is the part that
// lets a person check.
//
// Travels as a response header, because the body is a plain text stream.

import { classifySummaryContent } from "@/lib/summary-metadata"

/**
 * Where a remembered entry came from, in the timeline's vocabulary so the
 * chat can colour it with the same palette the timeline already uses. A
 * subset of `TimelineSource`: the report never sees index or todo rows.
 */
export type MemorySourceKey =
  | "claude-ai"
  | "claude-code"
  | "chatgpt"
  | "perplexity"
  | "chat"

/** One remembered entry, enough to name it and colour it. */
export interface MemoryEntryReport {
  title: string
  source: MemorySourceKey
  /** Conversation date as `YYYY-MM-DD`, when the entry states one. */
  date?: string
  /**
   * How many further conversations the same stored row holds. Bulk imports
   * pack several conversations into one row, and the title is only the
   * first of them — saying so beats naming one conversation for five.
   */
  more?: number
}

export interface MemoryLayerReport {
  /** Characters this layer contributed to the injected block. */
  chars: number
  /** Entries it contributed, where the layer is a list of them. */
  entries?: number
  /**
   * Oldest and newest conversation dates the layer covers, as `YYYY-MM-DD`.
   *
   * Counts alone could not answer the question people actually ask of this
   * panel — "does what you were given include yesterday?" — and without it a
   * block that had quietly stopped at some date in the past looked identical
   * to a healthy one. Absent when no entry carries a parseable date.
   */
  span?: { oldest: string; newest: string }
  /**
   * The entries themselves, by title and source, for the layers where that
   * list is short enough to show: the relevance matches for this question.
   * Counts said *how much* the model was told; this says *what*, which is
   * the part a person can actually recognise. Capped, and dropped first
   * when the header would not fit.
   */
  items?: MemoryEntryReport[]
}

export interface MemoryReport {
  /** False when the turn ran with no memory at all. */
  injected: boolean
  /** Present when the user's lessons document was included. */
  lessons?: MemoryLayerReport
  /** Baseline conversation history. */
  history?: MemoryLayerReport
  /** Always-on relevance matches for this specific question. */
  relevant?: MemoryLayerReport
  /** Verbatim transcripts, only on an explicit recovery request. */
  fullConversation?: MemoryLayerReport
  /** True when retrieval ran but matched nothing — the model was told to say
   *  so rather than guess, and the reader deserves to know that too. */
  fullConversationMissed?: boolean
  /** Total characters injected. */
  totalChars: number
  /** The allowance those characters were assembled against. */
  budgetChars: number
}

export const MEMORY_REPORT_HEADER = "x-chatmemo-memory"

/**
 * Encode a report for an HTTP header.
 *
 * Base64 because header values must be ASCII and the report can carry
 * non-ASCII text in future; returns null if encoding is unavailable or the
 * result would be implausibly large, since a missing header must degrade to
 * "no information" rather than breaking the response.
 */
export function encodeMemoryReport(report: MemoryReport): string | null {
  // Well under any reverse proxy's header limit. The counts are a few hundred
  // bytes; the entry titles are the only part that can grow, so they are the
  // part that goes when the report would not fit — the indicator then falls
  // back to counts rather than vanishing.
  return (
    encodeWithin(report, 4_000) ?? encodeWithin(withoutItems(report), 4_000)
  )
}

function encodeWithin(report: MemoryReport, limit: number): string | null {
  try {
    const json = JSON.stringify(report)
    const bytes = new TextEncoder().encode(json)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const encoded = btoa(binary)
    return encoded.length > limit ? null : encoded
  } catch {
    return null
  }
}

function withoutItems(report: MemoryReport): MemoryReport {
  const strip = (layer?: MemoryLayerReport) => {
    if (!layer) return layer
    const { items: _items, ...rest } = layer
    return rest
  }
  return {
    ...report,
    lessons: strip(report.lessons),
    history: strip(report.history),
    relevant: strip(report.relevant),
    fullConversation: strip(report.fullConversation)
  }
}

/** Decode a report from a header value. Returns null for anything unusable —
 *  the indicator simply does not render. */
export function decodeMemoryReport(value: string | null): MemoryReport | null {
  if (!value) return null
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.injected !== "boolean") return null
    return parsed as MemoryReport
  } catch {
    return null
  }
}

/** Entries in a section the builder joined with its own separator. */
const ENTRY_SEPARATOR = "\n\n---\n\n"

function countEntries(section: string): number {
  return section.split(ENTRY_SEPARATOR).filter(part => part.trim()).length
}

/** The `### [YYYY-MM-DD]` headers the importers and the summariser write,
 *  and the bracketless `### YYYY-MM-DD` the old Stop hook wrote. Missing the
 *  second made the span stop at the last bracketed row: "→ 2026-09-19" while
 *  a week of Claude Code sessions sat in the same section. */
const ENTRY_DATE_RE =
  /^###\s+(?:\[(\d{4}-\d{2}-\d{2})\]|(\d{4}-\d{2}-\d{2})\b)/gm

/**
 * The range of conversation dates a section covers.
 *
 * Read from the assembled text rather than tracked while building it, for the
 * same reason the counts are: the block is the single source of truth, and a
 * second one would drift. Rows with no header contribute nothing, so a section
 * of entirely undated content reports no span rather than a misleading one.
 */
function dateSpan(
  section: string
): { oldest: string; newest: string } | undefined {
  const dates = Array.from(
    section.matchAll(ENTRY_DATE_RE),
    match => match[1] ?? match[2]
  )
  if (dates.length === 0) return undefined

  // ISO dates sort lexicographically, so no parsing is needed — and none is
  // wanted: `new Date("2026-03-01")` would drag a timezone into a label.
  let oldest = dates[0]
  let newest = dates[0]
  for (const date of dates) {
    if (date < oldest) oldest = date
    if (date > newest) newest = date
  }

  return { oldest, newest }
}

/** How many entries a layer names. The relevance layer sends at most a
 *  handful of rows, so this is a guard rather than a truncation in practice. */
const MAX_REPORT_ENTRIES = 6
const TITLE_MAX = 60

// `[Claude Code]` from the laptop hook, `[Claude Code cloud]` from the cloud one.
const CLAUDE_CODE_TAG_RE = /\[claude code(?: cloud)?\]\s*/i

/**
 * The entries a layer names, one per matched row.
 *
 * Each entry is a row's content (or the head of it), so the same classifier
 * the database trigger mirrors gives its title, source and date. Untagged
 * rows with a date header came from Claude — the bookmarklet, the bulk
 * importer or the Claude Code hook — and the hook marks its titles, which
 * is how the two are told apart.
 */
function entryReports(entries: string[]): MemoryEntryReport[] {
  return entries
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, MAX_REPORT_ENTRIES)
    .map(entry => {
      const meta = classifySummaryContent(entry)
      const rawTitle = meta.title ?? "Conversation"
      const isClaudeCode = CLAUDE_CODE_TAG_RE.test(rawTitle)
      // A row with no header takes its first line as the title, and that
      // line is often a bullet or bold text: the markers are not the title.
      const cleaned = rawTitle
        .replace(CLAUDE_CODE_TAG_RE, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
      // Cut by code point, not by UTF-16 unit: slicing through an emoji
      // leaves half a surrogate pair, which renders as "�".
      const points = Array.from(cleaned)
      const title =
        points.length > TITLE_MAX
          ? points
              .slice(0, TITLE_MAX - 1)
              .join("")
              .trimEnd() + "…"
          : cleaned || "Conversation"
      const source: MemorySourceKey =
        meta.source === "claude"
          ? isClaudeCode
            ? "claude-code"
            : "claude-ai"
          : meta.source === "other"
            ? "chat"
            : meta.source
      const item: MemoryEntryReport = { title, source }
      if (meta.occurredAt) item.date = meta.occurredAt
      const conversations = entry.match(ENTRY_DATE_RE)?.length ?? 0
      if (conversations > 1) item.more = conversations - 1
      return item
    })
}

/**
 * Derive the report from the assembled block's own sections.
 *
 * Reading it back out of the text keeps the layers themselves unchanged: the
 * builder already delimits every section, so there is no second source of
 * truth to drift from the first.
 */
export function buildMemoryReport(input: {
  summary: string | null
  relevant: string | null
  /**
   * The rows behind `relevant`, one excerpt each. The entries are named
   * from these rather than by splitting `relevant` back apart: a stored
   * conversation can contain the separator, and splitting on it invented
   * entries titled with whatever line followed.
   */
  relevantEntries?: string[] | null
  fullConversation: string | null
  fullConversationMissed: boolean
  totalChars: number
  budgetChars: number
}): MemoryReport {
  const report: MemoryReport = {
    injected: input.totalChars > 0,
    totalChars: input.totalChars,
    budgetChars: input.budgetChars
  }

  if (input.summary) {
    const lessons = section(input.summary, "[LESSONS", "[/LESSONS]")
    if (lessons) report.lessons = { chars: lessons.length }

    const history = section(
      input.summary,
      "[CONVERSATION HISTORY",
      "[/CONVERSATION HISTORY]"
    )
    if (history) {
      report.history = {
        chars: history.length,
        entries: countEntries(history),
        span: dateSpan(history)
      }
    }
  }

  if (input.relevant) {
    report.relevant = {
      chars: input.relevant.length,
      entries: input.relevantEntries?.length ?? countEntries(input.relevant),
      span: dateSpan(input.relevant)
    }
    if (input.relevantEntries?.length) {
      report.relevant.items = entryReports(input.relevantEntries)
    }
  }

  if (input.fullConversation && !input.fullConversationMissed) {
    report.fullConversation = { chars: input.fullConversation.length }
  }

  if (input.fullConversationMissed) report.fullConversationMissed = true

  return report
}

function section(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null
  const end = text.indexOf(close, start)
  return text.slice(start, end === -1 ? undefined : end + close.length)
}
