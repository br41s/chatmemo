import { cutToFit } from "@/lib/server/cut-to-fit"
import { MEMORY_ORDER_COLUMN } from "@/lib/summary-metadata"
import { createClient } from "@/lib/supabase/server"
import { ContextBudget, resolveContextBudget } from "@/lib/context-budget"
import { neutraliseMemoryTags } from "@/lib/memory-block"
import {
  DateRange,
  detectFullConversationIntent,
  extractDateRange,
  extractIsoDate,
  extractQuotedPhrases,
  extractTopicWords
} from "@/lib/server/memory-terms"
import { cookies } from "next/headers"

// The trigger phrases, the month names and the bilingual stopword set used to
// live here — roughly 350 lines of literal data around the hundred that do the
// retrieval. They are in lib/server/memory-terms/ now; these re-exports keep
// the module's public surface unchanged for its existing callers.
export {
  detectFullConversationIntent,
  extractQuotedPhrases,
  extractTopicWords
} from "@/lib/server/memory-terms"

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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_CHATS = 3
const MAX_MESSAGES_PER_CHAT = 150
const MAX_SUMMARY_ROWS = 12
// Per-row cap must fit a whole conversation — when the user asks to recover a
// FULL conversation, truncating mid-transcript drops the assistant replies and
// makes the model think only the prompt was stored. 80k chars ≈ 20k tokens.
const MAX_ROW_CHARS = 80_000

/** Injected when retrieval runs but matches nothing. The chat route detects
 *  this to decide whether to keep baseline memory (see openrouter/route.ts). */
export const NO_FULL_MATCH_MARKER = "no matching conversation found"

/** Appended to a transcript that had to be shortened. The instructions tell
 *  the model a retrieved transcript is complete; this is how it learns that
 *  one is not. */
const TRANSCRIPT_CUT_NOTE =
  "\n[…the rest of this conversation was left out to fit this model's context window]"

/**
 * Search the summaries table for imported/full conversation rows matching the
 * given terms, then rank the candidates by RELEVANCE — how many distinct query
 * terms each row contains — before returning them.
 *
 * Why ranking matters: terms like "vuelo"/"madrid"/"cambiar" match dozens of
 * unrelated rows, while the rare term ("phuket") identifies the one the user
 * wants. Returning rows in term order let common-word hits flood the budget and
 * bury the real match. Scoring by distinct-term coverage surfaces the row that
 * matches the MOST of the user's words first, which is almost always the target.
 *
 * Returns content untruncated — these rows hold the full conversation text for
 * Perplexity and Claude imports. Excludes watermark rows and title-only
 * "Conversation Index" rows (they waste budget and carry no transcript).
 */
async function searchSummaries(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  terms: string[]
): Promise<string[]> {
  if (terms.length === 0) return []

  const usableTerms = terms
    .slice(0, 4)
    .map(t => t.replace(/[%_]/g, " ").trim())
    .filter(t => t.length >= 3)
  if (usableTerms.length === 0) return []

  interface Candidate {
    content: string
    createdAt: string
  }
  const candidates = new Map<string, Candidate>()

  // One ILIKE query per term (avoids PostgREST .or() comma-parsing issues with
  // multi-word phrases), run in parallel. Collect unique candidate rows across
  // all terms; results keep term order so dedup behavior matches the previous
  // sequential loop.
  const results = await Promise.all(
    usableTerms.map(term =>
      supabase
        .from("summaries")
        .select("id, content, created_at")
        .eq("user_id", userId)
        .ilike("content", `%${term}%`)
        .in("kind", ["conversation", "summary"])
        .order(MEMORY_ORDER_COLUMN, { ascending: false })
        .limit(MAX_SUMMARY_ROWS)
    )
  )

  for (const { data } of results) {
    for (const r of data ?? []) {
      if (candidates.has(r.id)) continue
      const content = neutraliseMemoryTags((r.content ?? "").trim())
      if (content) {
        candidates.set(r.id, { content, createdAt: r.created_at ?? "" })
      }
    }
  }

  // Rank by relevance (distinct-term coverage), then slice each to the row cap.
  return rankByTermCoverage([...candidates.values()], usableTerms).map(c =>
    c.content.slice(0, MAX_ROW_CHARS)
  )
}

/**
 * Summary rows whose conversation falls inside a date range, ranked by the
 * topic words when there are any.
 *
 * In-app summaries carry no `### [date]` header, so no text search can find
 * "yesterday's" conversation — only the row's own date can. `effective_at` is
 * that date: the conversation's stated one, or when the row was written.
 */
async function searchSummariesByDate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  range: DateRange,
  topicWords: string[]
): Promise<string[]> {
  const { data } = await supabase
    .from("summaries")
    .select("id, content, created_at")
    .eq("user_id", userId)
    .in("kind", ["conversation", "summary"])
    .gte(MEMORY_ORDER_COLUMN, range.from.toISOString())
    .lte(MEMORY_ORDER_COLUMN, range.to.toISOString())
    .order(MEMORY_ORDER_COLUMN, { ascending: false })
    .limit(MAX_SUMMARY_ROWS)

  const rows = (data ?? [])
    .map(r => ({
      content: neutraliseMemoryTags((r.content ?? "").trim()),
      createdAt: r.created_at ?? ""
    }))
    .filter(r => r.content)

  return rankByTermCoverage(rows, topicWords).map(r =>
    r.content.slice(0, MAX_ROW_CHARS)
  )
}

interface RankableRow {
  content: string
  createdAt: string
}

/**
 * Order rows by how many DISTINCT query terms each contains (desc), breaking
 * ties by recency (desc). A row matching phuket + vuelo + madrid + cambiar
 * ranks above a row matching only the common word cambiar. Pure + exported so
 * the ranking can be unit-tested without a database.
 */
export function rankByTermCoverage<T extends RankableRow>(
  rows: T[],
  terms: string[]
): T[] {
  const lowerTerms = terms.map(t => t.toLowerCase()).filter(t => t.length > 0)
  return rows
    .map(r => {
      const lower = r.content.toLowerCase()
      const score = lowerTerms.reduce(
        (n, t) => (lower.includes(t) ? n + 1 : n),
        0
      )
      return { row: r, score }
    })
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : b.row.createdAt.localeCompare(a.row.createdAt)
    )
    .map(s => s.row)
}

export async function getFullConversationForUser(
  userId: string,
  userMessage: string,
  budget: ContextBudget = resolveContextBudget()
): Promise<string | null> {
  if (!detectFullConversationIntent(userMessage)) return null

  const maxTotalChars = budget.fullConversationChars

  const supabase = createClient(await cookies())
  const isoDate = extractIsoDate(userMessage)
  const quoted = extractQuotedPhrases(userMessage)
  const topicWords = extractTopicWords(userMessage)

  // In-app chat search: prefer date, then quoted title, then topic words.
  const isoDayRange: DateRange | null = isoDate
    ? {
        from: new Date(`${isoDate}T00:00:00Z`),
        to: new Date(`${isoDate}T23:59:59Z`)
      }
    : null
  const dateRange = isoDayRange ?? extractDateRange(userMessage)
  const inAppTerms = quoted.length > 0 ? quoted : topicWords

  // Build summary search terms in PRIORITY order: an explicit date and a quoted
  // title are high-precision signals and must be searched (and budgeted) before
  // loose topic words, which can match many unrelated rows. Topic words are a
  // fallback only when no date and no quoted title were given — with a date,
  // they rank the rows of that date instead of searching all of history.
  const summaryTerms: string[] = []
  if (isoDate) summaryTerms.push(`[${isoDate}]`)
  summaryTerms.push(...quoted)
  if (summaryTerms.length === 0 && !dateRange) summaryTerms.push(...topicWords)

  const parts: string[] = []
  let totalChars = 0

  const pushBlock = (block: string): boolean => {
    if (!block) return true
    if (totalChars + block.length > maxTotalChars) {
      // The first conversation found is cut to what there is rather than
      // dropped. Dropping it left nothing, and nothing is reported as "no
      // matching conversation found" — untrue, and an invitation to guess.
      if (parts.length === 0) {
        const cut = cutToFit(block, maxTotalChars, TRANSCRIPT_CUT_NOTE)
        if (cut) {
          parts.push(cut)
          totalChars += cut.length
        }
      }
      return false
    }
    parts.push(block)
    totalChars += block.length
    return true
  }

  // --- 1. Imported / full-text conversations from summaries -----------------
  const [termHits, dateHits] = await Promise.all([
    searchSummaries(supabase, userId, summaryTerms),
    dateRange
      ? searchSummariesByDate(supabase, userId, dateRange, inAppTerms)
      : Promise.resolve([])
  ])
  // A row found both ways is pushed once; term hits keep their priority.
  for (const hit of [...new Set([...termHits, ...dateHits])]) {
    if (!pushBlock(hit)) break
  }

  // --- 2. In-app conversations from chats + messages ------------------------
  if (totalChars < maxTotalChars) {
    // `created_at`, not MEMORY_ORDER_COLUMN: `effective_at` is a column of
    // `summaries` only. Ordering chats by it failed every one of these queries,
    // and the error was dropped with `data`, so no in-app conversation was ever
    // recovered — "yesterday's chat" answered that nothing was stored.
    const chatQuery = (withTopic: boolean) => {
      let query = supabase
        .from("chats")
        .select("id, name, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_CHATS * 3)

      if (dateRange) {
        query = query
          .gte("created_at", dateRange.from.toISOString())
          .lte("created_at", dateRange.to.toISOString())
      }
      if (withTopic) {
        query = query.or(
          inAppTerms
            .map(w => `name.ilike.%${w.replace(/[%_,]/g, " ")}%`)
            .join(",")
        )
      }
      return query
    }

    const useTopic = inAppTerms.length > 0
    const { data: topicChats, error: chatError } = await chatQuery(useTopic)
    if (chatError) {
      console.error("[full-conversation] chat search failed:", chatError)
    }
    let chats = topicChats
    // A chat's name is only its opening words, so a topic that is not in the
    // name must not hide the chats of the day that was asked for.
    if ((chats ?? []).length === 0 && useTopic && dateRange) {
      chats = (await chatQuery(false)).data
    }

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

      if (!pushBlock(neutraliseMemoryTags(lines.join("\n")))) break
    }
  }

  if (parts.length === 0) {
    return (
      `[FULL CONVERSATION RETRIEVAL — ${NO_FULL_MATCH_MARKER}]\n` +
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
