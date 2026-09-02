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
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    const openai = new OpenAI({
      apiKey: profile.openrouter_api_key || "",
      baseURL: "https://openrouter.ai/api/v1"
    })

    const response = await openai.chat.completions.create({
      model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
      messages: messages as ChatCompletionMessageParam[],
      temperature: chatSettings.temperature,
      // Was `undefined`, which asks OpenRouter to reserve the model's whole
      // context window as possible output — 131,072 tokens for the default
      // model. OpenRouter charges affordability against that reservation, so a
      // key without room for the entire window is refused outright with a 402
      // rather than being allowed the reply it can actually pay for. Every
      // other provider route sends a real cap; this one never did.
      max_tokens: budget.outputTokens,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
