/**
 * Claude export parser — conversations.json format.
 *
 * Anthropic's official data export (Settings → Privacy → Export data) produces
 * a ZIP containing conversations.json with this structure:
 *
 *   Array<{
 *     uuid: string
 *     name: string
 *     summary: string
 *     created_at: string   // ISO 8601
 *     updated_at: string   // ISO 8601
 *     account: { uuid: string }
 *     chat_messages: Array<{
 *       uuid: string
 *       text: string                // ← clean plaintext, primary extraction target
 *       content: Array<ContentBlock> // may include tool_use blocks — skip those
 *       sender: "human" | "assistant"
 *       created_at: string
 *       updated_at: string
 *       attachments: unknown[]
 *       files: unknown[]
 *       parent_message_uuid: string | null
 *     }>
 *   }>
 *
 * Unlike ChatGPT exports, Claude messages are already in linear order — no
 * graph traversal needed. The `text` field is a pre-rendered plaintext
 * representation of the message, which is simpler and more reliable than
 * parsing the `content` array.
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
// Raw types (defensive — all optional except what we rely on)
// ---------------------------------------------------------------------------

interface RawContentBlock {
  type?: string
  text?: string
}

interface RawMessage {
  uuid?: string
  text?: string
  content?: RawContentBlock[]
  sender?: string
  created_at?: string
  updated_at?: string
}

interface RawConversation {
  uuid?: string
  name?: string
  summary?: string
  created_at?: string
  updated_at?: string
  chat_messages?: RawMessage[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_CONV = 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract clean text from a raw Claude message.
 * Priority:
 *   1. `msg.text` — flat plaintext, always present and clean
 *   2. Concatenate `content[]` blocks with `type === "text"` (fallback)
 */
function extractText(msg: RawMessage): string {
  const flat = (msg.text ?? "").trim()
  if (flat.length > 0) return flat

  if (Array.isArray(msg.content)) {
    const parts = msg.content
      .filter(b => b?.type === "text" && typeof b.text === "string")
      .map(b => (b.text ?? "").trim())
      .filter(Boolean)
    if (parts.length > 0) return parts.join("\n").trim()
  }

  return ""
}

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
 * Parse a raw Claude `conversations.json` array into a clean internal
 * representation. Returns ALL parseable conversations sorted newest-first.
 * Silently skips malformed entries.
 *
 * updatedAt is stored as UNIX milliseconds (consistent with all importers).
 *
 * @param raw - The parsed JSON value from conversations.json
 */
export function parseClaudeExport(raw: unknown): ParsedConversation[] {
  if (!Array.isArray(raw)) return []

  const results: ParsedConversation[] = []

  for (const item of raw) {
    try {
      const conv = item as RawConversation
      if (!conv || typeof conv !== "object") continue

      const messages = Array.isArray(conv.chat_messages)
        ? conv.chat_messages
        : []

      const parsed: ParsedMessage[] = []

      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue
        const sender = msg.sender
        if (sender !== "human" && sender !== "assistant") continue
        const text = extractText(msg)
        if (text.length === 0) continue
        parsed.push({ role: sender === "human" ? "user" : "assistant", text })
      }

      if (parsed.length === 0) continue

      const trimmed =
        parsed.length > MAX_MESSAGES_PER_CONV
          ? parsed.slice(-MAX_MESSAGES_PER_CONV)
          : parsed

      results.push({
        id: conv.uuid ?? crypto.randomUUID(),
        title: ((conv.name ?? "Untitled").trim() || "Untitled").slice(0, 200),
        updatedAt: isoToMs(conv.updated_at) || isoToMs(conv.created_at),
        messages: trimmed
      })
    } catch {
      // Never crash the whole import for a single malformed conversation
    }
  }

  // Sort newest first — no cap (process all conversations)
  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Raw storage — correct dates, no LLM
// ---------------------------------------------------------------------------

/**
 * Format a single conversation as a `### [YYYY-MM-DD] Title` section.
 * Used by the import route for raw per-conversation inserts (Step 1).
 * The timeline parser reads this header directly → correct date in timeline.
 */
export function formatConversationFull(conv: ParsedConversation): string {
  const header = `### [${msToDate(conv.updatedAt)}] ${safeTitle(conv.title)}`
  const body = conv.messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n")
  return `${header}\n\n${body}`
}

// ---------------------------------------------------------------------------
// LLM pass — quality memory extraction
// ---------------------------------------------------------------------------

/**
 * Build per-conversation text blocks for LLM summarisation.
 * Each item corresponds to ONE conversation.
 * Headers include `### [YYYY-MM-DD] Title` so the LLM output preserves
 * real dates in its summaries.
 */
export function buildPerConvTexts(
  conversations: ParsedConversation[]
): string[] {
  return conversations.map(conv => {
    const header = `### [${msToDate(conv.updatedAt)}] ${safeTitle(conv.title)}`
    const body = conv.messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n\n")
    return `${header}\n\n${body}`
  })
}

/**
 * Group conversations into LLM input chunks, each under `maxCharsPerChunk`.
 * Headers include `### [YYYY-MM-DD] Title` so the model can reproduce them
 * in its output → correct dates in LLM-generated summaries.
 */
export function buildSummaryChunks(
  conversations: ParsedConversation[],
  maxCharsPerChunk = 8_000
): string[] {
  const chunks: string[] = []
  let current = ""

  for (const conv of conversations) {
    const header = `\n### [${msToDate(conv.updatedAt)}] ${safeTitle(conv.title)}\n`
    const body = conv.messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n")
    const section = header + body

    if (
      current.length + section.length > maxCharsPerChunk &&
      current.length > 0
    ) {
      chunks.push(current.trim())
      current = section
    } else {
      current += section
    }
  }

  if (current.trim().length > 0) chunks.push(current.trim())
  return chunks
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
    `[Claude Conversation Index — imported ${new Date().toISOString().slice(0, 10)}]`,
    ...conversations.map(
      c => `[${msToDate(c.updatedAt)}] ${safeTitle(c.title)}`
    )
  ]
  return lines.join("\n")
}
