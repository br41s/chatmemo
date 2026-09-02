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
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    const openai = new OpenAI({
      apiKey: profile.openai_api_key || "",
      organization: profile.openai_organization_id
    })

    const response = await openai.chat.completions.create({
      model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
      messages: messages as ChatCompletionCreateParamsBase["messages"],
      temperature: chatSettings.temperature,
      // The TODO this replaces: 4096 for two models by name, and `null` —
      // unbounded — for everything else. The budget already reserved a share of
      // the window for the reply and trimmed history and memory to fit around
      // it, so this is the number the prompt was sized against. For gpt-4o and
      // gpt-4-vision-preview it is the same 4096 that was hardcoded.
      max_tokens: budget.outputTokens,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
