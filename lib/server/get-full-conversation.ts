import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

// ---------------------------------------------------------------------------
// Full conversation retrieval
//
// Only fires when the user's message contains an explicit "full conversation"
// intent. Queries chats + messages tables and returns a formatted transcript
// block for injection into the system prompt.
//
// Zero cost on regular questions — intent detection is pure string matching.
// ---------------------------------------------------------------------------

const TRIGGERS = [
  "full conversation",
  "complete conversation",
  "entire conversation",
  "whole conversation",
  "original conversation",
  "all messages",
  "recover conversation",
  "what did we say",
  "what did we discuss",
  "transcript"
]

const TRIGGER_PATTERNS = [
  /show\b.{0,30}\bconversation/,
  /find\b.{0,30}\bconversation/,
  /search\b.{0,30}\bconversation/,
  /retrieve\b.{0,30}\bconversation/,
  /get\b.{0,30}\bconversation/
]

export function detectFullConversationIntent(message: string): boolean {
  const lower = message.toLowerCase()
  if (TRIGGERS.some(t => lower.includes(t))) return true
  if (TRIGGER_PATTERNS.some(p => p.test(lower))) return true
  return false
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

interface DateRange {
  from: Date
  to: Date
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

function extractDateRange(message: string): DateRange | null {
  const lower = message.toLowerCase()
  const now = new Date()

  // "January 2025" or "2025 January"
  for (const [name, num] of Object.entries(MONTHS)) {
    const re = new RegExp(`(?:${name}\\s+(20\\d{2})|(20\\d{2})\\s+${name})`)
    const m = lower.match(re)
    if (m) {
      const year = parseInt(m[1] ?? m[2])
      return {
        from: new Date(year, num - 1, 1),
        to: new Date(year, num, 0, 23, 59, 59)
      }
    }
  }

  // Month name only → most recent occurrence of that month
  for (const [name, num] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      const year = now.getFullYear()
      const from = new Date(year, num - 1, 1)
      const to = new Date(year, num, 0, 23, 59, 59)
      if (from > now) {
        from.setFullYear(year - 1)
        to.setFullYear(year - 1)
      }
      return { from, to }
    }
  }

  // Bare year "2025"
  const yearM = lower.match(/\b(202\d)\b/)
  if (yearM) {
    const year = parseInt(yearM[1])
    return {
      from: new Date(year, 0, 1),
      to: new Date(year, 11, 31, 23, 59, 59)
    }
  }

  // Relative
  if (lower.includes("yesterday")) {
    const from = new Date(now)
    from.setDate(from.getDate() - 1)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  if (lower.includes("last week")) {
    const from = new Date(now)
    from.setDate(from.getDate() - 7)
    return { from, to: now }
  }
  if (lower.includes("last month")) {
    const from = new Date(now)
    from.setMonth(from.getMonth() - 1)
    return { from, to: now }
  }

  return null
}

// ---------------------------------------------------------------------------
// Topic extraction
// ---------------------------------------------------------------------------

const STOP = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "get",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "let",
  "like",
  "may",
  "me",
  "more",
  "most",
  "my",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  // intent words — strip from topic extraction
  "full",
  "complete",
  "entire",
  "whole",
  "original",
  "show",
  "find",
  "search",
  "retrieve",
  "recover",
  "get",
  "access",
  "read",
  "see",
  "view",
  "give",
  "tell",
  "provide",
  "please",
  "help",
  "want",
  "need",
  "conversation",
  "conversations",
  "chat",
  "chats",
  "message",
  "messages",
  "topic",
  "regarding",
  "transcript",
  "date",
  "time",
  "back",
  "look",
  "trying",
  "looking",
  "remember",
  "recall"
])

function extractTopicWords(message: string): string[] {
  const monthPattern = new RegExp(
    `\\b(${Object.keys(MONTHS).join("|")})\\b`,
    "g"
  )
  const cleaned = message
    .toLowerCase()
    .replace(/\b202\d\b/g, " ")
    .replace(monthPattern, " ")
    .replace(/[^a-z0-9\s]/g, " ")

  const words = cleaned.split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))

  return [...new Set(words)].slice(0, 3)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_CHATS = 3
const MAX_MESSAGES_PER_CHAT = 150
const MAX_TOTAL_CHARS = 50_000

export async function getFullConversationForUser(
  userId: string,
  userMessage: string
): Promise<string | null> {
  if (!detectFullConversationIntent(userMessage)) return null

  const supabase = createClient(cookies())
  const dateRange = extractDateRange(userMessage)
  const topicWords = extractTopicWords(userMessage)

  // Build the chats query with optional date and topic filters
  const base = supabase
    .from("chats")
    .select("id, name, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_CHATS * 3)

  const withDate = dateRange
    ? base
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString())
    : base

  const withTopic =
    topicWords.length > 0
      ? withDate.or(topicWords.map(w => `name.ilike.%${w}%`).join(","))
      : withDate

  const { data: chats } = await withTopic

  if (!chats || chats.length === 0) {
    return (
      "[FULL CONVERSATION RETRIEVAL — no matching in-app chats found]\n" +
      "No in-app conversations matched the requested topic/date. " +
      "If the conversation was imported from an external source (ChatGPT, Perplexity, Claude), " +
      "only summaries are available — check [CONVERSATION HISTORY] above.\n" +
      "[/FULL CONVERSATION RETRIEVAL]"
    )
  }

  const parts: string[] = []
  let totalChars = 0

  for (const chat of chats.slice(0, MAX_CHATS)) {
    const { data: messages } = await supabase
      .from("messages")
      .select("role, content, sequence_number")
      .eq("chat_id", chat.id)
      .order("sequence_number", { ascending: true })
      .limit(MAX_MESSAGES_PER_CHAT)

    if (!messages || messages.length === 0) continue

    const date = new Date(chat.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    })
    const lines: string[] = [`--- Chat: "${chat.name}" (${date}) ---`]

    for (const msg of messages) {
      if (msg.role === "system") continue
      lines.push(`${msg.role}: ${msg.content}`)
    }

    const block = lines.join("\n")
    if (totalChars + block.length > MAX_TOTAL_CHARS) break

    parts.push(block)
    totalChars += block.length
  }

  if (parts.length === 0) {
    return (
      "[FULL CONVERSATION RETRIEVAL — chats found but no messages]\n" +
      "Matching chats were found but contained no messages.\n" +
      "[/FULL CONVERSATION RETRIEVAL]"
    )
  }

  return (
    `[FULL CONVERSATION RETRIEVAL — ${parts.length} chat(s) found]\n` +
    parts.join("\n\n") +
    "\n[/FULL CONVERSATION RETRIEVAL]"
  )
}
