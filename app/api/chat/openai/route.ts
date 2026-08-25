import { createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import { ServerRuntime } from "next"
import OpenAI from "openai"
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions.mjs"

export const runtime: ServerRuntime = "edge"

export const POST = createChatRoute({
  provider: "OpenAI",
  apiKey: profile => profile.openai_api_key,
  // OpenAI says so in the message rather than only in the status.
  incorrectKey: { kind: "message", contains: "incorrect api key" },
  respond: async ({ profile, chatSettings, messages, headers }) => {
    const openai = new OpenAI({
      apiKey: profile.openai_api_key || "",
      organization: profile.openai_organization_id
    })

    const response = await openai.chat.completions.create({
      model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
      messages: messages as ChatCompletionCreateParamsBase["messages"],
      temperature: chatSettings.temperature,
      max_tokens:
        chatSettings.model === "gpt-4-vision-preview" ||
        chatSettings.model === "gpt-4o"
          ? 4096
          : null, // TODO: Fix
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
