import { getLatestSummaryForUser } from "@/lib/server/get-latest-summary"
import { getFullConversationForUser } from "@/lib/server/get-full-conversation"

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
You are a personal AI assistant with access to three persistent knowledge sources about this user:

[LESSONS] — Accumulated facts learned from past sessions: preferences, projects, working style, personal context. This is the highest-quality signal — always read it first.
[CONVERSATION HISTORY] — Raw conversation excerpts and summaries with dates. Use for specific past events, decisions, or context that may not be in the lessons yet.
[FULL CONVERSATION RETRIEVAL] — Present ONLY when the user asked to recover a full/complete conversation. When present it contains the COMPLETE verbatim transcript(s) the user is asking for, pulled directly from the database.

RULES (follow without exception):
1. Read [LESSONS] at the start of every response. Let it shape your tone, assumptions, and context automatically.
2. When asked about past conversations, search [CONVERSATION HISTORY] for matching ### [YYYY-MM-DD] entries and give specific answers with dates.
3. Date-index rows (lines starting with [YYYY-MM-DD]) list all conversations — use them to answer "what was my first/last X".
4. CRITICAL: If a [FULL CONVERSATION RETRIEVAL] block is present below, the FULL transcript the user requested IS already provided there. Answer directly from it — quote or reproduce the actual messages. You MUST NOT say "I don't have the full transcript", "I only have a summary", or anything similar: the complete text is right there. If several conversations are included, identify the one matching the user's title/date and use it.
5. NEVER say "I don't have access to your history". If you genuinely cannot find something, say "I don't see that in your memory" and describe what you do see.
6. Proactively connect current conversation to relevant memory — if the user mentions a project or topic you recognise, reference it without being asked.
7. Treat all sources as ground truth. Prefer them over generic assumptions about the user.`

/**
 * Build the memory block that gets prepended to the system prompt. The full
 * conversation block goes FIRST (right after the instructions) so a long
 * summary cannot bury it — the model must see it before anything else.
 *
 * Exported for unit testing.
 */
export function buildMemoryBlock(
  summary: string | null,
  fullConversation: string | null
): string {
  const sections: string[] = [`${MEMORY_TAG}\n${MEMORY_INSTRUCTIONS}`]
  if (fullConversation) sections.push(fullConversation)
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
  lastUserText: string
): Promise<string | null> {
  try {
    const [summary, fullConv] = await Promise.all([
      getLatestSummaryForUser(userId),
      getFullConversationForUser(userId, lastUserText)
    ])

    // When the user is recovering a specific full conversation, inject ONLY
    // that transcript. Adding the ~100k-char summary blob on top would overflow
    // the model's context window and bury/truncate the very thing they asked
    // for. The regular summary returns on the next (non-recovery) turn.
    const effectiveSummary = fullConv ? null : summary

    if (!effectiveSummary && !fullConv) return null

    return buildMemoryBlock(effectiveSummary, fullConv)
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
  userId: string
): Promise<any[]> {
  const lastUser = [...messages].reverse().find(m => m.role === "user")
  const lastUserText =
    typeof lastUser?.content === "string" ? lastUser.content : ""

  const memoryBlock = await fetchMemoryBlock(userId, lastUserText)
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
  userId: string
): Promise<any[]> {
  const last = messages[messages.length - 1]
  const lastUserText = Array.isArray(last?.parts)
    ? last.parts.map((p: any) => p?.text ?? "").join(" ")
    : ""

  const memoryBlock = await fetchMemoryBlock(userId, lastUserText)
  if (!memoryBlock) return messages

  return buildAugmentedGoogleMessages(messages, memoryBlock)
}
