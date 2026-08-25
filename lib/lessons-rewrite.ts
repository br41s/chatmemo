// Whether a proposed rewrite of the lessons document is safe to store.
//
// The lessons pass is a full read-modify-write: read the document, hand it to
// the model, replace it with whatever comes back. That is fine while the
// document is small and catastrophic once it is not — a rewrite that ran out
// of output room looks exactly like a valid shorter document, and writing it
// destroys every fact the model had not reached yet. There is no version
// history for user_lessons to recover from, unlike summaries.
//
// So a rewrite has to earn the write. Three independent checks, because the
// most reliable signal is not always available: the provider may not report a
// finish reason, and a model can also stop early on its own.

/** Section headings the prompt tells the model to always maintain. Losing one
 *  is the clearest sign that output was cut off mid-document. */
const REQUIRED_SECTION_RE = /^##\s+(.+)$/gm

/** A legitimate edit consolidates; it does not delete a fifth of the document.
 *  Below this ratio a rewrite is treated as lossy rather than concise. */
const MIN_RETAINED_RATIO = 0.8

export type RewriteVerdict =
  | { ok: true }
  | { ok: false; reason: string; detail?: string }

export interface RewriteCheckInput {
  previous: string | null
  next: string
  /** The model reported it stopped because it hit the token limit. */
  truncated: boolean
}

function sectionHeadings(text: string): string[] {
  return [...text.matchAll(REQUIRED_SECTION_RE)].map(m => m[1].trim())
}

/**
 * Decide whether `next` may replace `previous`.
 *
 * Pure + exported so every rejection path can be tested without a model or a
 * database — these are the checks standing between a bad generation and
 * permanent loss of the user's accumulated context.
 */
export function checkLessonsRewrite(input: RewriteCheckInput): RewriteVerdict {
  const next = input.next.trim()

  if (!next) {
    return { ok: false, reason: "empty" }
  }

  // The model told us it ran out of room. Nothing else needs checking.
  if (input.truncated) {
    return { ok: false, reason: "truncated" }
  }

  const previous = input.previous?.trim()

  // First write: nothing to lose, so only the emptiness check applies.
  if (!previous) return { ok: true }

  if (next === previous) {
    return { ok: false, reason: "unchanged" }
  }

  const missing = sectionHeadings(previous).filter(
    heading => !next.includes(heading)
  )
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "section-lost",
      detail: missing.join(", ")
    }
  }

  if (next.length < previous.length * MIN_RETAINED_RATIO) {
    return {
      ok: false,
      reason: "shrank",
      detail: `${previous.length} -> ${next.length} chars`
    }
  }

  return { ok: true }
}

/**
 * Output allowance for rewriting a document of this size.
 *
 * The previous fixed 800 guaranteed truncation once the document outgrew it.
 * The rewrite has to restate everything it keeps, so the allowance has to
 * scale with the input, with headroom for the facts being added.
 */
export function lessonsRewriteMaxTokens(previous: string | null): number {
  const CHARS_PER_TOKEN = 4
  const HEADROOM = 1.35
  const FLOOR = 800
  const CEILING = 8_000

  const previousTokens = Math.ceil((previous?.length ?? 0) / CHARS_PER_TOKEN)
  return Math.min(
    CEILING,
    Math.max(FLOOR, Math.ceil(previousTokens * HEADROOM))
  )
}

/**
 * Past this, a rewrite could not restate the document even at the ceiling
 * allowance, so attempting one risks exactly the loss this module prevents.
 * Skipping is the safe answer; the document needs restructuring instead.
 *
 * Derived from the ceiling above: 8k output tokens at ~4 chars each, less the
 * headroom the rewrite needs to restate what it keeps.
 */
export const MAX_LESSONS_CHARS = Math.floor((8_000 * 4) / 1.35)
