/**
 * ChatGPT export parser — conversations.json format.
 *
 * The official ChatGPT export is a ZIP containing conversations.json.
 * This module operates on the already-extracted JSON array.
 *
 * Export format (as of 2024-2025):
 *   Array of conversation objects, each with a `mapping` graph.
 *   The mapping is a node graph (not a linear array). To reconstruct
 *   the ordered thread we walk from the root to `current_node`.
 */

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
// Parsed / internal types
// ---------------------------------------------------------------------------

export interface ParsedMessage {
  role: "user" | "assistant"
  text: string
}

export interface ParsedConversation {
  id: string
  title: string
  updatedAt: number // unix timestamp
  messages: ParsedMessage[]
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
 * mapping nodes — only `parent` links are reliable. We therefore walk
 * BACKWARDS from `current_node` following parent references, then reverse
 * the collected path to get chronological order.
 *
 * This is simpler and handles all known export formats correctly.
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

/** Maximum messages to keep per conversation when building raw rows. */
const MAX_MESSAGES_RAW = 20

/** Maximum messages to keep per conversation for LLM summarisation. */
const MAX_MESSAGES_LLM = 40

/** How many recent conversations to send through the LLM pass. */
export const LLM_CONV_LIMIT = 40

/**
 * Parse a raw ChatGPT `conversations.json` array into a clean internal
 * representation. Returns ALL parseable conversations sorted newest-first.
 * Silently skips malformed entries.
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

      results.push({
        id: conv.id ?? crypto.randomUUID(),
        title: (conv.title ?? "Untitled").slice(0, 200),
        updatedAt: conv.update_time ?? conv.create_time ?? 0,
        messages
      })
    } catch {
      // Skip malformed entries — never crash the whole import
    }
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a unix timestamp (seconds) to YYYY-MM-DD. */
function tsToDate(ts: number): string {
  return ts > 0
    ? new Date(ts * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
}

/** Strip characters that would confuse the `### [YYYY-MM-DD]` header parser. */
function safeTitle(title: string): string {
  return title.replace(/[\[\]]/g, "").trim() || "Untitled"
}

// ---------------------------------------------------------------------------
// Raw rows — fast insert, all conversations, correct dates
// ---------------------------------------------------------------------------

/**
 * Format every conversation as a `### [YYYY-MM-DD] Title` section followed
 * by a compact message excerpt.  Groups `convsPerRow` conversations per row
 * so the summaries table stays manageable.
 *
 * The timeline parser already understands this header format, so each row
 * produces correctly-dated entries without any LLM call.
 */
export function buildRawRows(
  conversations: ParsedConversation[],
  convsPerRow = 5
): string[] {
  const rows: string[] = []

  for (let i = 0; i < conversations.length; i += convsPerRow) {
    const batch = conversations.slice(i, i + convsPerRow)
    const text = batch
      .map(conv => {
        const date = tsToDate(conv.updatedAt)
        const header = `### [${date}] ${safeTitle(conv.title)}`
        const msgs = conv.messages
          .slice(-MAX_MESSAGES_RAW)
          .map(
            m =>
              `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 300)}`
          )
          .join("\n")
        return `${header}\n${msgs}`
      })
      .join("\n\n")
    rows.push(text)
  }

  return rows
}

// ---------------------------------------------------------------------------
// LLM chunks — quality memory extraction for the most recent conversations
// ---------------------------------------------------------------------------

/**
 * Build LLM input chunks for the top `LLM_CONV_LIMIT` most-recent
 * conversations.  Each chunk fits within `maxCharsPerChunk` and is sent as
 * a single summarisation call.  The system prompt must ask the model to
 * emit `### [YYYY-MM-DD] Title` headers so the timeline parser picks up
 * the correct dates.
 */
export function buildSummaryChunks(
  conversations: ParsedConversation[],
  maxCharsPerChunk = 12_000
): string[] {
  const top = conversations.slice(0, LLM_CONV_LIMIT)
  const chunks: string[] = []
  let current = ""

  for (const conv of top) {
    const date = tsToDate(conv.updatedAt)
    const header = `\n### [${date}] ${safeTitle(conv.title)}\n`
    const body = conv.messages
      .slice(-MAX_MESSAGES_LLM)
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
