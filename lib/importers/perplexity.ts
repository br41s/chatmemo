/**
 * Perplexity export parser — conversations JSON format.
 *
 * Perplexity's data export produces a JSON file with this structure:
 *
 *   {
 *     "conversations": Array<{
 *       context_uuid:  string
 *       context_title: string
 *       created_at:    string   // ISO 8601
 *       updated_at:    string   // ISO 8601
 *       mode:          string   // e.g. "COPILOT", "DEFAULT", "REASONING"
 *       collection_uuid: string | null
 *       entries: Array<{
 *         entry_uuid:   string
 *         query:        string  // user message
 *         answer:       string  // Perplexity response
 *         created_at:   string  // ISO 8601
 *         label:        string | null
 *         query_status: string  // "COMPLETED" | others
 *       }>
 *     }>
 *   }
 *
 * Unlike ChatGPT, the structure is linear (no graph traversal needed).
 * Unlike Claude, the top-level is an object with a `conversations` key,
 * not a bare array.
 *
 * The `mode` field (COPILOT, DEFAULT, REASONING, etc.) is stored as
 * metadata in the text so it can be recalled and filtered later.
 */

import {
  buildRawRows,
  msToDate,
  safeTitle,
  type ParsedConversation,
  type ParsedMessage
} from "./shared"

export type { ParsedConversation, ParsedMessage }
export { buildRawRows }

// ---------------------------------------------------------------------------
// Raw types (defensive — all optional)
// ---------------------------------------------------------------------------

interface RawEntry {
  entry_uuid?: string
  query?: string
  answer?: string
  created_at?: string
  query_status?: string
}

interface RawConversation {
  context_uuid?: string
  context_title?: string
  created_at?: string
  updated_at?: string
  mode?: string
  entries?: RawEntry[]
}

interface RawExport {
  conversations?: RawConversation[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_CONV = 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO 8601 string to unix milliseconds. Returns 0 on failure. */
function isoToMs(iso: string | undefined): number {
  if (!iso) return 0
  const ts = Date.parse(iso)
  return isNaN(ts) ? 0 : ts
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw Perplexity export object into a clean internal representation.
 * Returns ALL parseable conversations sorted newest-first.
 * Silently skips malformed entries.
 *
 * updatedAt is stored as UNIX milliseconds (consistent with all importers).
 */
export function parsePerplexityExport(raw: unknown): ParsedConversation[] {
  if (!raw || typeof raw !== "object") return []

  const exportObj = raw as RawExport
  const conversations = exportObj.conversations
  if (!Array.isArray(conversations)) return []

  const results: ParsedConversation[] = []

  for (const item of conversations) {
    try {
      const conv = item as RawConversation
      if (!conv || typeof conv !== "object") continue

      const entries = Array.isArray(conv.entries) ? conv.entries : []
      const parsed: ParsedMessage[] = []

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue
        // Only include completed entries
        if (entry.query_status && entry.query_status !== "COMPLETED") continue

        const query = (entry.query ?? "").trim()
        const answer = (entry.answer ?? "").trim()

        if (query.length > 0) {
          parsed.push({ role: "user", text: query })
        }
        if (answer.length > 0) {
          parsed.push({ role: "assistant", text: answer })
        }
      }

      if (parsed.length === 0) continue

      const trimmed =
        parsed.length > MAX_MESSAGES_PER_CONV
          ? parsed.slice(-MAX_MESSAGES_PER_CONV)
          : parsed

      // Derive date: prefer conversation-level fields, fall back to the
      // most recent entry's created_at, then today as last resort.
      const convTs = Math.max(
        isoToMs(conv.updated_at),
        isoToMs(conv.created_at)
      )
      const entryTs = entries.reduce(
        (max, e) => Math.max(max, isoToMs(e.created_at)),
        0
      )
      const updatedAt = convTs || entryTs || Date.now()

      results.push({
        id: conv.context_uuid ?? crypto.randomUUID(),
        title: safeTitle(
          (conv.context_title ?? "Untitled").trim().slice(0, 200)
        ),
        updatedAt,
        messages: trimmed,
        meta: { mode: (conv.mode ?? "DEFAULT").toUpperCase() }
      })
    } catch {
      // Never crash the whole import for a single malformed conversation
    }
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Raw storage — correct dates, no LLM
// ---------------------------------------------------------------------------

/**
 * Format a single conversation as a `### [YYYY-MM-DD] Title` section.
 * Includes the Perplexity mode as a metadata line after the header.
 */
export function formatConversationFull(conv: ParsedConversation): string {
  const mode = conv.meta?.mode ?? "DEFAULT"
  const header = `### [${msToDate(conv.updatedAt)}] ${safeTitle(conv.title)}`
  const meta = `Source: Perplexity / ${mode}`
  const body = conv.messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n")
  return `${header}\n${meta}\n\n${body}`
}

// ---------------------------------------------------------------------------
// Date index
// ---------------------------------------------------------------------------

/**
 * Build a compact date-index string listing all conversations by date.
 * Inserted as a single summary row for fast historical lookups.
 */
export function buildDateIndex(conversations: ParsedConversation[]): string {
  const lines = [
    `[Perplexity Conversation Index — imported ${new Date().toISOString().slice(0, 10)}]`,
    ...conversations.map(c => {
      const mode = c.meta?.mode ?? "DEFAULT"
      return `[${msToDate(c.updatedAt)}] ${safeTitle(c.title)} (${mode})`
    })
  ]
  return lines.join("\n")
}
