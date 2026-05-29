import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { getLatestSummaryForUser } from "@/lib/server/get-latest-summary"
import { getFullConversationForUser } from "@/lib/server/get-full-conversation"
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
[FULL CONVERSATION RETRIEVAL] — Present only when the user asked to recover a full conversation. Contains the complete verbatim transcript(s) from the messages database.

RULES (follow without exception):
1. Read [LESSONS] at the start of every response. Let it shape your tone, assumptions, and context automatically.
2. When asked about past conversations, search [CONVERSATION HISTORY] for matching ### [YYYY-MM-DD] entries and give specific answers with dates.
3. Date-index rows (lines starting with [YYYY-MM-DD]) list all conversations — use them to answer "what was my first/last X".
4. When [FULL CONVERSATION RETRIEVAL] is present, use it as the authoritative source for that conversation — it contains the actual messages, not summaries.
5. NEVER say "I don't have access to your history". If you cannot find something, say "I don't see that in your memory" and describe what you do see.
6. Proactively connect current conversation to relevant memory — if the user mentions a project or topic you recognise, reference it without being asked.
7. Treat all sources as ground truth. Prefer them over generic assumptions about the user.`

function injectSummaryIntoMessages(
  messages: ChatCompletionMessageParam[],
  summary: string
): ChatCompletionMessageParam[] {
  const memoryBlock =
    `${MEMORY_TAG}\n${MEMORY_INSTRUCTIONS}\n\n` +
    `[MEMORY CONTENT — newest entries first]\n${summary}\n[/CHATMEMO_MEMORY]\n\n`

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

    const [summary, fullConv] = await Promise.all([
      getLatestSummaryForUser(profile.user_id),
      getFullConversationForUser(profile.user_id, lastUserText)
    ])

    const memoryText = [summary, fullConv].filter(Boolean).join("\n\n")
    const augmentedMessages = memoryText
      ? injectSummaryIntoMessages(messages, memoryText)
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
