import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

// ---------------------------------------------------------------------------
// Full conversation retrieval
//
// Only fires when the user's message contains an explicit "full conversation"
// intent (English or Spanish). It then searches BOTH places where full
// conversation text lives:
//
//   1. summaries table — imported conversations (Perplexity / Claude store the
//      full text; ChatGPT stores a truncated copy). These rows are normally
//      capped at 400 chars during regular memory retrieval; here we return
//      them untruncated.
//   2. messages table — in-app ChatMemo conversations, full transcript.
//
// Zero cost on regular questions — intent detection is pure string matching
// with no DB call unless triggered.
// ---------------------------------------------------------------------------

const TRIGGERS = [
  // English — conversation/chat variants
  "full conversation",
  "complete conversation",
  "entire conversation",
  "whole conversation",
  "original conversation",
  "full chat",
  "complete chat",
  "entire chat",
  "whole chat",
  "full thread",
  "all messages",
  "full transcript",
  "recover conversation",
  "recover the conversation",
  "recover chat",
  "recover the chat",
  "what did we say",
  "what did we discuss",
  "transcript",
  // Spanish
  "conversacion completa",
  "conversación completa",
  "conversacion entera",
  "conversación entera",
  "conversacion original",
  "conversación original",
  "chat completo",
  "chat entero",
  "transcripcion",
  "transcripción",
  "que hablamos",
  "qué hablamos",
  "que dijimos",
  "qué dijimos",
  "recupera la conversacion",
  "recupera la conversación",
  "recuperar la conversacion",
  "recuperar la conversación",
  "recupera el chat",
  "recuperar el chat",
  "recupera la primera",
  "recupera la ultima",
  "recupera la última",
  "dame la primera",
  "dame el chat",
  "dame la conversacion",
  "dame la conversación"
]

const TRIGGER_PATTERNS = [
  // English: verb ... conversation/chat/thread/transcript
  /\b(show|find|search|retrieve|get|recover|give|fetch|pull|read)\b.{0,40}\b(conversation|chat|thread|transcript)/,
  // English: full/complete/entire ... chat/conversation/thread
  /\b(full|complete|entire|whole|original)\b.{0,20}\b(chat|conversation|thread|transcript)/,
  // Spanish: verb ... conversación/chat
  /\b(recupera|recuperar|muestra|muestrame|muéstrame|busca|buscar|dame|ensename|enséñame|saca|trae)\b.{0,40}\b(conversaci[oó]n|chat)/,
  // Spanish: conversación/chat ... completa/entera/original
  /\b(conversaci[oó]n|chat)\b.{0,40}\b(completa|completo|entera|entero|original|integra|íntegra)/
]

export function detectFullConversationIntent(message: string): boolean {
  const lower = message.toLowerCase()
  if (TRIGGERS.some(t => lower.includes(t))) return true
  if (TRIGGER_PATTERNS.some(p => p.test(lower))) return true
  return false
}

// ---------------------------------------------------------------------------
// Quoted-title extraction (strongest signal — user usually quotes the title)
// ---------------------------------------------------------------------------

/**
 * Pull quoted phrases from the message. Handles straight and curly quotes.
 * Each phrase is trimmed at the first comma so it stays safe to use as a
 * single ILIKE substring (the stored title still contains the full text, and
 * ILIKE matches the comma-free prefix).
 */
function extractQuotedPhrases(message: string): string[] {
  const phrases: string[] = []
  const re = /["“”'']([^"“”'']{4,})["“”'']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const raw = m[1].trim()
    const prefix = raw.split(",")[0].trim()
    if (prefix.length >= 4) phrases.push(prefix)
  }
  return phrases
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

/** Extract an explicit ISO date (YYYY-MM-DD) if present — used to match the
 *  `### [YYYY-MM-DD]` header embedded in imported summary rows. */
function extractIsoDate(message: string): string | null {
  const m = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
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
  if (lower.includes("yesterday") || lower.includes("ayer")) {
    const from = new Date(now)
    from.setDate(from.getDate() - 1)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  if (lower.includes("last week") || lower.includes("semana pasada")) {
    const from = new Date(now)
    from.setDate(from.getDate() - 7)
    return { from, to: now }
  }
  if (lower.includes("last month") || lower.includes("mes pasado")) {
    const from = new Date(now)
    from.setMonth(from.getMonth() - 1)
    return { from, to: now }
  }

  return null
}

// ---------------------------------------------------------------------------
// Topic extraction (fallback when the user didn't quote a title)
// ---------------------------------------------------------------------------

const STOP = new Set([
  // English
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
  // English intent words
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
  "recall",
  // Spanish stopwords + intent words
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "que",
  "como",
  "para",
  "por",
  "con",
  "del",
  "mi",
  "tu",
  "su",
  "se",
  "lo",
  "le",
  "en",
  "y",
  "o",
  "sobre",
  "esa",
  "ese",
  "esta",
  "este",
  "esto",
  "eso",
  "mas",
  "más",
  "muy",
  "fue",
  "era",
  "recupera",
  "recuperar",
  "muestra",
  "muestrame",
  "muéstrame",
  "dame",
  "quiero",
  "necesito",
  "busca",
  "buscar",
  "completa",
  "completo",
  "entera",
  "entero",
  "conversacion",
  "conversación",
  "conversaciones",
  "primera",
  "primero",
  "ultima",
  "última",
  "ultimo",
  "último",
  "comentas",
  "dijimos",
  "hablamos",
  "transcripcion",
  "transcripción",
  "mensaje",
  "mensajes",
  "fecha",
  "tema"
])

function extractTopicWords(message: string): string[] {
  const monthPattern = new RegExp(
    `\\b(${Object.keys(MONTHS).join("|")})\\b`,
    "g"
  )
  const cleaned = message
    .toLowerCase()
    .replace(/\b202\d\b/g, " ")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(monthPattern, " ")
    .replace(/[^a-z0-9áéíóúñü\s]/g, " ")

  const words = cleaned.split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))

  return [...new Set(words)].slice(0, 4)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_CHATS = 3
const MAX_MESSAGES_PER_CHAT = 150
const MAX_SUMMARY_ROWS = 6
const MAX_ROW_CHARS = 20_000
const MAX_TOTAL_CHARS = 50_000

/**
 * Search the summaries table for imported/full conversation rows matching the
 * given terms (quoted title prefixes or topic words) and/or an explicit date.
 * Returns content untruncated — these rows hold the full conversation text for
 * Perplexity and Claude imports. Excludes watermark/index bookkeeping rows.
 */
async function searchSummaries(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  terms: string[],
  isoDate: string | null
): Promise<string[]> {
  const matchTerms = [...terms]
  if (isoDate) matchTerms.push(`[${isoDate}]`)
  if (matchTerms.length === 0) return []

  const seen = new Set<string>()
  const rows: string[] = []

  // One ILIKE query per term (avoids PostgREST .or() comma-parsing issues with
  // multi-word phrases). Results are de-duplicated by row id.
  for (const term of matchTerms.slice(0, 4)) {
    const escaped = term.replace(/[%_]/g, " ").trim()
    if (escaped.length < 3) continue

    const { data } = await supabase
      .from("summaries")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("content", `%${escaped}%`)
      .not("content", "like", "[chatmemo:%")
      .order("created_at", { ascending: false })
      .limit(MAX_SUMMARY_ROWS)

    for (const r of data ?? []) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const content = (r.content ?? "").trim()
      if (content) rows.push(content.slice(0, MAX_ROW_CHARS))
    }
  }

  return rows
}

export async function getFullConversationForUser(
  userId: string,
  userMessage: string
): Promise<string | null> {
  if (!detectFullConversationIntent(userMessage)) return null

  const supabase = createClient(cookies())
  const dateRange = extractDateRange(userMessage)
  const isoDate = extractIsoDate(userMessage)
  const quoted = extractQuotedPhrases(userMessage)
  const topicWords = extractTopicWords(userMessage)

  // Prefer quoted title phrases; fall back to extracted topic words.
  const summaryTerms = quoted.length > 0 ? quoted : topicWords

  const parts: string[] = []
  let totalChars = 0

  const pushBlock = (block: string): boolean => {
    if (!block) return true
    if (totalChars + block.length > MAX_TOTAL_CHARS) return false
    parts.push(block)
    totalChars += block.length
    return true
  }

  // --- 1. Imported / full-text conversations from summaries -----------------
  const summaryHits = await searchSummaries(
    supabase,
    userId,
    summaryTerms,
    isoDate
  )
  for (const hit of summaryHits) {
    if (!pushBlock(hit)) break
  }

  // --- 2. In-app conversations from chats + messages ------------------------
  if (totalChars < MAX_TOTAL_CHARS) {
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

    const inAppTerms = quoted.length > 0 ? quoted : topicWords
    const withTopic =
      inAppTerms.length > 0
        ? withDate.or(
            inAppTerms
              .map(w => `name.ilike.%${w.replace(/[%_,]/g, " ")}%`)
              .join(",")
          )
        : withDate

    const { data: chats } = await withTopic

    for (const chat of (chats ?? []).slice(0, MAX_CHATS)) {
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

      if (!pushBlock(lines.join("\n"))) break
    }
  }

  if (parts.length === 0) {
    return (
      "[FULL CONVERSATION RETRIEVAL — no matching conversation found]\n" +
      "No stored conversation matched the requested title/date. Ask the user " +
      "to confirm the exact title, date, or source (in-app, Perplexity, " +
      "ChatGPT, Claude). Do not invent content.\n" +
      "[/FULL CONVERSATION RETRIEVAL]"
    )
  }

  return (
    `[FULL CONVERSATION RETRIEVAL — ${parts.length} match(es), verbatim source of truth]\n` +
    parts.join("\n\n") +
    "\n[/FULL CONVERSATION RETRIEVAL]"
  )
}
