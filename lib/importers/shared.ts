/**
 * Shared types and utilities for all conversation importers.
 *
 * Each importer (ChatGPT, Claude, future sources) has its own parser for the
 * source-specific format, but once parsed into ParsedConversation they all
 * share these helpers for formatting and storage.
 *
 * Timestamp convention: updatedAt is always UNIX milliseconds so a single
 * msToDate() helper works for every importer.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedMessage {
  role: "user" | "assistant"
  text: string
}

export interface ParsedConversation {
  id: string
  title: string
  /** Unix timestamp in milliseconds. */
  updatedAt: number
  messages: ParsedMessage[]
  /** Optional importer-specific metadata (e.g. Perplexity mode). */
  meta?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Convert a unix millisecond timestamp to YYYY-MM-DD. Falls back to today. */
export function msToDate(ms: number): string {
  return ms > 0
    ? new Date(ms).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/** Strip [ ] characters that would break the `### [YYYY-MM-DD]` header parser. */
export function safeTitle(title: string): string {
  return title.replace(/[\[\]]/g, "").trim() || "Untitled"
}

// ---------------------------------------------------------------------------
// Raw row builder
// ---------------------------------------------------------------------------

/**
 * Format every conversation as a `### [YYYY-MM-DD] Title` section and group
 * `convsPerRow` conversations per DB row.
 *
 * No LLM call needed — the timeline parser reads `### [YYYY-MM-DD]` headers
 * directly, so each entry gets the real conversation date automatically.
 *
 * @param conversations  Sorted list (newest first).
 * @param convsPerRow    How many conversations to pack into each DB row.
 * @param maxMsgsPerConv Max messages to include per conversation (most recent).
 * @param maxMsgChars    Max characters per individual message.
 * @param source         Optional source tag prepended to each row (e.g. "chatgpt").
 *                       Enables selective deletion via the clear-source API.
 */
export function buildRawRows(
  conversations: ParsedConversation[],
  convsPerRow = 5,
  maxMsgsPerConv = 20,
  maxMsgChars = 300,
  source?: string
): string[] {
  const rows: string[] = []
  const sourcePrefix = source ? `[source:${source}]\n` : ""

  for (let i = 0; i < conversations.length; i += convsPerRow) {
    const batch = conversations.slice(i, i + convsPerRow)
    const text = batch
      .map(conv => {
        const header = `### [${msToDate(conv.updatedAt)}] ${safeTitle(conv.title)}`
        const msgs = conv.messages
          .slice(-maxMsgsPerConv)
          .map(
            m =>
              `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, maxMsgChars)}`
          )
          .join("\n")
        return `${header}\n${msgs}`
      })
      .join("\n\n")
    rows.push(`${sourcePrefix}${text}`)
  }

  return rows
}
