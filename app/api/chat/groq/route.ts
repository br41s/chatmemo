import { createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import OpenAI from "openai"

export const runtime = "edge"

export const POST = createChatRoute({
  provider: "Groq",
  apiKey: profile => profile.groq_api_key,
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    // Groq is compatible with the OpenAI SDK
    const groq = new OpenAI({
      apiKey: profile.groq_api_key || "",
      baseURL: "https://api.groq.com/openai/v1"
    })

    const response = await groq.chat.completions.create({
      model: chatSettings.model,
      messages,
      max_tokens: budget.outputTokens,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
