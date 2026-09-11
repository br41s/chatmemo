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
  try {
    const json = JSON.stringify(report)
    const bytes = new TextEncoder().encode(json)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const encoded = btoa(binary)
    // Well under any reverse proxy's header limit; a report is a few hundred
    // bytes, so anything near this is a bug rather than data.
    return encoded.length > 4_000 ? null : encoded
  } catch {
    return null
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

/** The `### [YYYY-MM-DD]` headers the importers and the summariser write. */
const ENTRY_DATE_RE = /^###\s+\[(\d{4}-\d{2}-\d{2})\]/gm

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
  const dates = Array.from(section.matchAll(ENTRY_DATE_RE), match => match[1])
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
      entries: countEntries(input.relevant),
      span: dateSpan(input.relevant)
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
