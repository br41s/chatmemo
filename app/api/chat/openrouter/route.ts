import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { getLatestSummaryForUser } from "@/lib/server/get-latest-summary"
import {
  getFullConversationForUser,
  NO_FULL_MATCH_MARKER
} from "@/lib/server/get-full-conversation"
import { getRelevantMemoryForUser } from "@/lib/server/get-relevant-memory"
import { ChatSettings } from "@/types"
import { OpenAIStream, StreamingTextResponse } from "ai"
import { ServerRuntime } from "next"
import OpenAI from "openai"
import {
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions.mjs"

const MEMORY_TAG = "[CHATMEMO_MEMORY]"

const MEMORY_INSTRUCTIONS = `\
You are a personal AI assistant with access to three persistent knowledge sources about this user:

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

function injectMemoryIntoMessages(
  messages: ChatCompletionMessageParam[],
  summary: string | null,
  fullConversation: string | null,
  relevantMemory: string | null
): ChatCompletionMessageParam[] {
  // The full conversation and relevant-memory blocks go FIRST (right after the
  // instructions) so the long summary blob cannot bury them — the model must
  // see the targeted matches before the bulk history.
  const sections: string[] = [`${MEMORY_TAG}\n${MEMORY_INSTRUCTIONS}`]
  if (fullConversation) sections.push(fullConversation)
  if (relevantMemory) sections.push(relevantMemory)
  if (summary)
    sections.push(`[MEMORY CONTENT — newest entries first]\n${summary}`)
  sections.push(`[/CHATMEMO_MEMORY]`)
  const memoryBlock = sections.join("\n\n") + "\n\n"

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

export const runtime: ServerRuntime = "edge"

export async function POST(request: Request) {
  const json = await request.json()
  const { chatSettings, messages } = json as {
    chatSettings: ChatSettings
    messages: ChatCompletionMessageParam[]
  }

  try {
    const profile = await getServerProfile()

    checkApiKey(profile.openrouter_api_key, "OpenRouter")

    const lastUserContent = [...messages].reverse().find(m => m.role === "user")
    const lastUserText =
      typeof lastUserContent?.content === "string"
        ? lastUserContent.content
        : ""

    const [summary, fullConv, relevantMemory] = await Promise.all([
      getLatestSummaryForUser(profile.user_id),
      getFullConversationForUser(profile.user_id, lastUserText),
      getRelevantMemoryForUser(profile.user_id, lastUserText)
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

    const augmentedMessages =
      effectiveSummary || fullConv || effectiveRelevant
        ? injectMemoryIntoMessages(
            messages,
            effectiveSummary,
            fullConv,
            effectiveRelevant
          )
        : messages

    const openai = new OpenAI({
      apiKey: profile.openrouter_api_key || "",
      baseURL: "https://openrouter.ai/api/v1"
    })

    const response = await openai.chat.completions.create({
      model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
      messages: augmentedMessages,
      temperature: chatSettings.temperature,
      max_tokens: undefined,
      stream: true
    })

    const stream = OpenAIStream(response)

    return new StreamingTextResponse(stream)
  } catch (error: any) {
    let errorMessage = error.message || "An unexpected error occurred"
    const errorCode = error.status || 500

    if (errorMessage.toLowerCase().includes("api key not found")) {
      errorMessage =
        "OpenRouter API Key not found. Please set it in your profile settings."
    }

    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
