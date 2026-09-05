import { createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import OpenAI from "openai"

export const runtime = "edge"

export const POST = createChatRoute({
  provider: "Mistral",
  apiKey: profile => profile.mistral_api_key,
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    // Mistral is compatible with the OpenAI SDK
    const mistral = new OpenAI({
      apiKey: profile.mistral_api_key || "",
      baseURL: "https://api.mistral.ai/v1"
    })

    const response = await mistral.chat.completions.create({
      model: chatSettings.model,
      messages,
      max_tokens: budget.outputTokens,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
