/**
 * ChatGPT export parser — conversations.json format.
 *
 * The official ChatGPT export is a ZIP containing conversations.json.
 * This module operates on the already-extracted JSON array.
 *
 * Export format (as of 2024-2025):
 *   Array of conversation objects, each with a `mapping` graph.
 *   The mapping is a node graph (not a linear array). To reconstruct
 *   the ordered thread we walk BACKWARDS from `current_node` via
 *   parent references (newer exports no longer populate `children`).
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
// Raw ChatGPT export types (defensive — all fields optional except essentials)
// ---------------------------------------------------------------------------

interface RawContentPart {
  content_type?: string
  text?: string
}

interface RawMessageContent {
  content_type?: string
  /** parts can be strings or rich objects (image refs, etc.) */
  parts?: Array<string | RawContentPart | null>
}

interface RawMessage {
  id?: string
  author?: { role?: string }
  content?: RawMessageContent
  create_time?: number | null
}

interface RawNode {
  id?: string
  message?: RawMessage | null
  parent?: string | null
  children?: string[]
}

interface RawConversation {
  id?: string
  title?: string
  create_time?: number
  update_time?: number
  mapping?: Record<string, RawNode>
  current_node?: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract plain text from a raw message content block. */
function extractText(content: RawMessageContent | undefined): string {
  if (!content) return ""

  // Modern export: parts array (text messages, multimodal, etc.)
  if (content.parts && content.parts.length > 0) {
    return content.parts
      .map(part => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && typeof part.text === "string")
          return part.text
        return ""
      })
      .join("")
      .trim()
  }

  // Older / code / execution_output nodes store text directly on content
  if (typeof (content as Record<string, unknown>).text === "string") {
    return ((content as Record<string, unknown>).text as string).trim()
  }

  return ""
}

/**
 * Reconstruct the linear message thread for a conversation.
 *
 * Newer ChatGPT exports (2025+) do NOT populate the `children` array on
 * mapping nodes — only `parent` links are reliable. We walk BACKWARDS from
 * `current_node` following parent references, then reverse to get
 * chronological order.
 */
function reconstructThread(
  mapping: Record<string, RawNode>,
  currentNodeId: string | null | undefined
): ParsedMessage[] {
  if (!currentNodeId || !mapping[currentNodeId]) return []

  // Walk backwards from current_node to root via parent links
  const path: string[] = []
  let cursor: string | null | undefined = currentNodeId
  while (cursor && mapping[cursor]) {
    path.push(cursor)
    cursor = mapping[cursor].parent
  }
  path.reverse() // now root → current_node

  const messages: ParsedMessage[] = []
  for (const nodeId of path) {
    const msg = mapping[nodeId]?.message
    const role = msg?.author?.role
    if (role !== "user" && role !== "assistant") continue
    const text = extractText(msg?.content)
    if (text.length > 0) {
      messages.push({ role, text })
    }
  }

  return messages
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw ChatGPT `conversations.json` array into a clean internal
 * representation. Returns ALL parseable conversations sorted newest-first.
 * Silently skips malformed entries.
 *
 * updatedAt is stored as UNIX milliseconds (consistent with all importers).
 *
 * @param raw - The parsed JSON value from conversations.json
 */
export function parseChatGPTExport(raw: unknown): ParsedConversation[] {
  if (!Array.isArray(raw)) return []

  const results: ParsedConversation[] = []

  for (const item of raw) {
    try {
      const conv = item as RawConversation
      if (!conv?.mapping || typeof conv.mapping !== "object") continue

      const messages = reconstructThread(conv.mapping, conv.current_node)
      if (messages.length === 0) continue

      // ChatGPT timestamps are unix seconds → convert to ms
      const updatedAtMs = (conv.update_time ?? conv.create_time ?? 0) * 1000

      results.push({
        id: conv.id ?? crypto.randomUUID(),
        title: (conv.title ?? "Untitled").slice(0, 200),
        updatedAt: updatedAtMs,
        messages
      })
    } catch {
      // Skip malformed entries — never crash the whole import
    }
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt)
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
    `[ChatGPT Conversation Index — imported ${new Date().toISOString().slice(0, 10)}]`,
    ...conversations.map(
      c => `[${msToDate(c.updatedAt)}] ${safeTitle(c.title)}`
    )
  ]
  return lines.join("\n")
}
