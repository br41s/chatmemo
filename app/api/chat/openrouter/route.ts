import { createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import { ServerRuntime } from "next"
import OpenAI from "openai"
import {
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions.mjs"

export const runtime: ServerRuntime = "edge"

export const POST = createChatRoute({
  provider: "OpenRouter",
  apiKey: profile => profile.openrouter_api_key,
  respond: async ({ profile, chatSettings, messages, headers }) => {
    const openai = new OpenAI({
      apiKey: profile.openrouter_api_key || "",
      baseURL: "https://openrouter.ai/api/v1"
    })

    const response = await openai.chat.completions.create({
      model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
      messages: messages as ChatCompletionMessageParam[],
      temperature: chatSettings.temperature,
      max_tokens: undefined,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
