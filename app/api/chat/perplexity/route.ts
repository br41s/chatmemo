import { createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import OpenAI from "openai"

export const runtime = "edge"

export const POST = createChatRoute({
  provider: "Perplexity",
  apiKey: profile => profile.perplexity_api_key,
  respond: async ({ profile, chatSettings, messages, headers }) => {
    // Perplexity is compatible with the OpenAI SDK
    const perplexity = new OpenAI({
      apiKey: profile.perplexity_api_key || "",
      baseURL: "https://api.perplexity.ai/"
    })

    const response = await perplexity.chat.completions.create({
      model: chatSettings.model,
      messages,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
