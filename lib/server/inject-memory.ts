import { getLatestSummaryForUser } from "@/lib/server/get-latest-summary"
import {
  getFullConversationForUser,
  NO_FULL_MATCH_MARKER
} from "@/lib/server/get-full-conversation"
import { getRelevantMemoryForUser } from "@/lib/server/get-relevant-memory"
import {
  ContextBudget,
  ContextBudgetHint,
  resolveContextBudget
} from "@/lib/context-budget"

// ---------------------------------------------------------------------------
// Shared memory injection
//
// Every provider chat route (openrouter, openai, anthropic, mistral, groq,
// perplexity, azure, google) injects the user's persistent memory into the
// system prompt so the model knows about the user regardless of which model
// they pick. The logic originally lived only in the openrouter route; it now
// lives here so every route shares one source of truth.
//
// Two message shapes are supported:
//   - OpenAI format: { role, content } where content is a string or an array
//     of content parts. Used by openrouter/openai/anthropic/mistral/groq/
//     perplexity/azure.
//   - Google Gemini format: { role, parts: [{ text }] }. The system prompt is
//     adapted to role "user" with a text part (see adaptMessagesForGoogleGemini
//     in lib/build-prompt.ts).
// ---------------------------------------------------------------------------

const MEMORY_TAG = "[CHATMEMO_MEMORY]"

const MEMORY_INSTRUCTIONS = `\
You are a personal AI assistant with access to several persistent knowledge sources about this user:

[LESSONS] — Accumulated facts learned from past sessions: preferences, projects, working style, personal context. This is the highest-quality signal — always read it first.
[CONVERSATION HISTORY] — Raw conversation excerpts and summaries with dates. Use for specific past events, decisions, or context that may not be in the lessons yet.
[RELEVANT MEMORY] — When present, the entries here are the closest matches to the user's CURRENT question, pulled verbatim from their history and shown with more detail than the truncated history blob. Prefer these for specific facts (flight numbers, dates, prices, decisions) before falling back to [CONVERSATION HISTORY].
[FULL CONVERSATION RETRIEVAL] — Present ONLY when the user asked to recover a full/complete conversation. When present it contains the COMPLETE verbatim transcript(s) the user is asking for, pulled directly from the database.

RULES (follow without exception):
1. Read [LESSONS] at the start of every response. Let it shape your tone, assumptions, and context automatically.
2. When asked about past conversations, search [CONVERSATION HISTORY] for matching ### [YYYY-MM-DD] entries and give specific answers with dates.
3. Date-index rows (lines starting with [YYYY-MM-DD]) list all conversations — use them to answer "what was my first/last X".
4. CRITICAL: If a [FULL CONVERSATION RETRIEVAL] block is present below, the FULL transcript the user requested IS already provided there. Answer directly from it — quote or reproduce the actual messages. You MUST NOT say "I don't have the full transcript", "I only have a summary", or anything similar: the complete text is right there. If several conversations are included, identify the one matching the user's title/date and use it.
5. ANTI-FABRICATION (most important rule): Everything you state about the user's past — quotes, dates, flight numbers, names, prices, decisions, outcomes — MUST come verbatim from the sections below. NEVER invent or paraphrase-into-quotes content that is not present. Do not reconstruct a "Tú: … / Yo: …" dialogue from memory. If the specific conversation or fact the user asks about is NOT in the provided sections, say so plainly — e.g. "No encuentro esa conversación en tu memoria" / "I don't see that conversation in your memory" — and ask the user for the exact title, date, or source (in-app, Perplexity, ChatGPT, Claude). It is always better to admit the gap than to guess.
6. You CANNOT produce links or URLs to past conversations. If asked for a link, say so; offer to retrieve the content instead.
7. NEVER say "I don't have access to your history" — you do. When you cannot find a specific item, follow rule 5: name what you searched and what you actually see, and ask for more detail.
8. Proactively connect the current conversation to memory ONLY when you have a concrete matching entry in the sections below. A vague topical association is not a match — do not present it as one.`

/**
 * Build the memory block that gets prepended to the system prompt. The full
 * conversation and relevant-memory blocks go FIRST (right after the
 * instructions) so a long summary cannot bury them — the model must see the
 * targeted matches before the bulk history.
 *
 * `relevantMemory` is optional so existing 2-arg callers stay valid.
 *
 * Exported for unit testing.
 */
export function buildMemoryBlock(
  summary: string | null,
  fullConversation: string | null,
  relevantMemory: string | null = null
): string {
  const sections: string[] = [`${MEMORY_TAG}\n${MEMORY_INSTRUCTIONS}`]
  if (fullConversation) sections.push(fullConversation)
  if (relevantMemory) sections.push(relevantMemory)
  if (summary)
    sections.push(`[MEMORY CONTENT — newest entries first]\n${summary}`)
  sections.push(`[/CHATMEMO_MEMORY]`)
  return sections.join("\n\n") + "\n\n"
}

/**
 * Fetch the user's memory for the current turn. Returns the memory block string
 * to prepend, or null when there is nothing to inject.
 *
 * A failure here must never break the chat — if memory retrieval throws, we log
 * and degrade to no memory rather than returning a 500 to the user.
 */
async function fetchMemoryBlock(
  userId: string,
  lastUserText: string,
  budget: ContextBudget
): Promise<string | null> {
  try {
    const [summary, fullConv, relevantMemory] = await Promise.all([
      getLatestSummaryForUser(userId, budget),
      getFullConversationForUser(userId, lastUserText, budget),
      getRelevantMemoryForUser(userId, lastUserText, budget)
    ])

    // When the user is recovering a specific full conversation AND we actually
    // found transcript(s), inject ONLY that transcript — adding the ~100k-char
    // summary blob on top would overflow the context window and bury/truncate
    // the very thing they asked for.
    //
    // But on a retrieval MISS (the sentinel "no matching conversation found"),
    // keep the baseline summary so the model still has context to work from and
    // is far less likely to fabricate. The sentinel is tiny, so no overflow.
    const fullConvFoundMatch =
      !!fullConv && !fullConv.includes(NO_FULL_MATCH_MARKER)
    const effectiveSummary = fullConvFoundMatch ? null : summary
    // On a full-conversation match the verbatim transcript already answers the
    // question — skip the relevance section to avoid burying/overflowing it.
    const effectiveRelevant = fullConvFoundMatch ? null : relevantMemory

    if (!effectiveSummary && !fullConv && !effectiveRelevant) return null

    return buildMemoryBlock(effectiveSummary, fullConv, effectiveRelevant)
  } catch (error) {
    console.error("Memory injection failed; continuing without memory:", error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Pure transforms (no DB) — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Prepend a memory block to OpenAI-format messages ({ role, content }). The
 * block is prepended to the existing system message, or a new system message is
 * inserted when there is none. Idempotent: if the system message already
 * carries the memory tag (e.g. on a regeneration/retry) the input is returned
 * unchanged.
 */
export function buildAugmentedOpenAIMessages(
  messages: any[],
  memoryBlock: string
): any[] {
  const first = messages[0]

  if (first?.role === "system") {
    // Can't inject into non-string content (array of parts) — leave unchanged
    if (typeof first.content !== "string") return messages
    // Already injected — skip to prevent duplication on retries
    if (first.content.includes(MEMORY_TAG)) return messages
    return [
      { ...first, content: `${memoryBlock}${first.content}` },
      ...messages.slice(1)
    ]
  }

  // No system message — insert one
  return [{ role: "system", content: memoryBlock }, ...messages]
}

/**
 * Prepend a memory block to Google Gemini-format messages
 * ({ role, parts: [{ text }] }). The block is prepended to the first message's
 * first text part (the adapted system prompt), or a new user message carrying
 * the memory is inserted when the first message has no text part. Idempotent
 * via the memory tag, same as the OpenAI variant.
 */
export function buildAugmentedGoogleMessages(
  messages: any[],
  memoryBlock: string
): any[] {
  const first = messages[0]
  const firstText = first?.parts?.[0]?.text

  if (typeof firstText === "string") {
    // Already injected — skip to prevent duplication on retries
    if (firstText.includes(MEMORY_TAG)) return messages
    return [
      {
        ...first,
        parts: [{ text: `${memoryBlock}${firstText}` }, ...first.parts.slice(1)]
      },
      ...messages.slice(1)
    ]
  }

  // No suitable text part to prepend to — insert a dedicated memory message
  return [{ role: "user", parts: [{ text: memoryBlock }] }, ...messages]
}

// ---------------------------------------------------------------------------
// OpenAI-format injection
// ---------------------------------------------------------------------------

/**
 * Inject memory into OpenAI-format messages ({ role, content }). Used by
 * openrouter/openai/anthropic/mistral/groq/perplexity/azure routes.
 */
export async function injectMemoryOpenAIFormat(
  messages: any[],
  userId: string,
  budgetHint?: ContextBudgetHint
): Promise<any[]> {
  const lastUser = [...messages].reverse().find(m => m.role === "user")
  const lastUserText =
    typeof lastUser?.content === "string" ? lastUser.content : ""

  // Re-resolved here rather than taken from the client: the hint describes the
  // model, the split is the server's to decide.
  const budget = resolveContextBudget(budgetHint)
  const memoryBlock = await fetchMemoryBlock(userId, lastUserText, budget)
  if (!memoryBlock) return messages

  return buildAugmentedOpenAIMessages(messages, memoryBlock)
}

// ---------------------------------------------------------------------------
// Google Gemini-format injection
// ---------------------------------------------------------------------------

/**
 * Inject memory into Google Gemini-format messages ({ role, parts: [{ text }] }).
 */
export async function injectMemoryGoogleFormat(
  messages: any[],
  userId: string,
  budgetHint?: ContextBudgetHint
): Promise<any[]> {
  const last = messages[messages.length - 1]
  const lastUserText = Array.isArray(last?.parts)
    ? last.parts.map((p: any) => p?.text ?? "").join(" ")
    : ""

  const budget = resolveContextBudget(budgetHint)
  const memoryBlock = await fetchMemoryBlock(userId, lastUserText, budget)
  if (!memoryBlock) return messages

  return buildAugmentedGoogleMessages(messages, memoryBlock)
}
