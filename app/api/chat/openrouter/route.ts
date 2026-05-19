import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { getLatestSummaryForUser } from "@/lib/server/get-latest-summary"
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
You are a personal AI assistant with access to the user's long-term memory — their full conversation history imported from Claude and ChatGPT, plus summaries generated from past sessions.

MEMORY RULES (follow these without exception):
1. ALWAYS search through the memory block below before answering any question about the user's past, projects, preferences, or history.
2. When asked about past conversations ("what was my first X", "have I talked about Y", "when did I..."), look for matching ### [YYYY-MM-DD] headers or index entries and give a specific answer with the date.
3. The memory includes date-index rows listing every conversation by date — use them to answer questions about oldest/newest/first conversations.
4. NEVER say "I don't have access to your history" or "I can't see your previous conversations". The history IS the memory block below. If you cannot find something there, say "I don't see that in your imported memory" and describe what you do see.
5. Proactively surface relevant memory context even when the user doesn't explicitly ask — if they mention a project or topic you recognise from memory, reference it.
6. Treat the memory as ground truth about the user. Prefer it over generic assumptions.`

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

    const summary = await getLatestSummaryForUser(profile.user_id)
    const augmentedMessages = summary
      ? injectSummaryIntoMessages(messages, summary)
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
