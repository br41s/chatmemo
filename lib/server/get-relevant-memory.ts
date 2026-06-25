import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import {
  extractQuotedPhrases,
  extractTopicWords,
  rankByTermCoverage
} from "./get-full-conversation"

// ---------------------------------------------------------------------------
// Always-on relevance retrieval
//
// The baseline memory blob (get-latest-summary.ts) truncates "bulk" rows
// (Perplexity + ChatGPT imports) to 400 chars — title + first line only — so
// the real detail (flight numbers, dates, prices, decisions) never reaches the
// model on an ordinary recall question. The full-conversation path
// (get-full-conversation.ts) returns those rows untruncated, but only when the
// message contains an explicit "recover the conversation" trigger phrase.
//
// This module fills the gap between them. On EVERY turn it runs a cheap
// relevance search over ALL summaries using the quoted phrases + topic words of
// the user's latest message, ranks matches by distinct-term coverage (reusing
// rankByTermCoverage), and injects the top few rows with a generous per-row
// excerpt. No trigger phrase required — old/bulk conversations surface for
// natural questions like "what did I decide about my Qatar flight?".
//
// Cost control: returns null immediately when the message has no meaningful
// topic words (greetings, "ok", "thanks"…), so no DB call happens. When it does
// run it is bounded to one query per term and a tight char budget.
// ---------------------------------------------------------------------------

const MAX_TERMS = 4
const ROWS_PER_TERM = 8 // candidate rows fetched per ILIKE term
const MAX_RELEVANT_ROWS = 4 // top-ranked rows injected
const RELEVANT_ROW_MAX = 2_000 // per-row excerpt cap (vs 400 in baseline)
const RELEVANT_BUDGET = 6_000 // total char budget for the section (~1.5k tokens)

const INDEX_MARKER = "Conversation Index"

// Conversational filler that survives the shared STOP list (>3 chars, not a
// stopword) but carries no recall signal. Searching for these would run a DB
// query on greetings and acknowledgements ("thanks", "hola") with no chance of
// a useful match. Kept local so the shared STOP set — and the full-conversation
// extraction that depends on it — stay untouched. Single-word phrases only;
// multi-word quoted titles are never filtered here.
const FILLER = new Set([
  // English
  "hello",
  "hey",
  "hiya",
  "yeah",
  "yep",
  "nope",
  "okay",
  "sure",
  "thanks",
  "thank",
  "thankyou",
  "cheers",
  "cool",
  "great",
  "nice",
  "good",
  "morning",
  "evening",
  // Spanish
  "hola",
  "gracias",
  "vale",
  "bueno",
  "buenas",
  "buenos",
  "genial",
  "claro",
  "perfecto",
  "saludos",
  "adios",
  "hasta"
])

/**
 * Build the relevance search terms for a message: quoted phrases (high
 * precision) first, then topic words, deduped and capped. Drops conversational
 * filler so greetings/acks don't trigger a search. Returns an empty array when
 * there is nothing worth searching for — the caller uses that as a zero-cost
 * early exit. Pure + exported so the gating can be unit-tested.
 */
export function buildRelevantTerms(message: string): string[] {
  const quoted = extractQuotedPhrases(message)
  const topics = extractTopicWords(message)
  return [...new Set([...quoted, ...topics])]
    .map(t => t.replace(/[%_]/g, " ").trim())
    .filter(t => t.length >= 3 && !FILLER.has(t.toLowerCase()))
    .slice(0, MAX_TERMS)
}

/**
 * Returns a [RELEVANT MEMORY] section with the top summaries matching the
 * user's latest message, or null when nothing relevant is found (or the message
 * carries no topic words). Content is verbatim from the DB — safe against
 * fabrication.
 */
export async function getRelevantMemoryForUser(
  userId: string,
  userMessage: string
): Promise<string | null> {
  const terms = buildRelevantTerms(userMessage)
  if (terms.length === 0) return null

  const supabase = createClient(cookies())

  interface Candidate {
    content: string
    createdAt: string
  }
  const candidates = new Map<string, Candidate>()

  // One ILIKE per term over ALL summaries (incl. bulk rows — that's the point).
  // Exclude watermark and title-only index rows: they carry no recall detail.
  const results = await Promise.all(
    terms.map(term =>
      supabase
        .from("summaries")
        .select("id, content, created_at")
        .eq("user_id", userId)
        .ilike("content", `%${term}%`)
        .not("content", "like", "[chatmemo:%")
        .not("content", "ilike", `%${INDEX_MARKER}%`)
        .order("created_at", { ascending: false })
        .limit(ROWS_PER_TERM)
    )
  )

  for (const { data } of results) {
    for (const r of data ?? []) {
      if (candidates.has(r.id)) continue
      const content = (r.content ?? "").trim()
      if (content) {
        candidates.set(r.id, { content, createdAt: r.created_at ?? "" })
      }
    }
  }

  if (candidates.size === 0) return null

  // Rank by distinct-term coverage (recency tie-break), then fill the budget
  // with the top rows, each excerpt capped.
  const ranked = rankByTermCoverage([...candidates.values()], terms)

  const blocks: string[] = []
  let chars = 0
  for (const row of ranked.slice(0, MAX_RELEVANT_ROWS)) {
    const excerpt =
      row.content.length > RELEVANT_ROW_MAX
        ? row.content.slice(0, RELEVANT_ROW_MAX) + "…"
        : row.content
    if (chars + excerpt.length > RELEVANT_BUDGET) break
    blocks.push(excerpt)
    chars += excerpt.length
  }

  if (blocks.length === 0) return null

  return (
    "[RELEVANT MEMORY — top matches for the current question, verbatim from your history]\n" +
    blocks.join("\n\n---\n\n") +
    "\n[/RELEVANT MEMORY]"
  )
}
