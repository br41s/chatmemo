import { ChatProfile, createChatRoute } from "@/lib/server/chat-route"
import { openAIStreamResponse } from "@/lib/server/streaming"
import { ChatSettings } from "@/types"
import OpenAI from "openai"
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions.mjs"

export const runtime = "edge"

/** Azure addresses a deployment, not a model, and the mapping lives on the
 *  profile — a model with no deployment configured cannot be called at all. */
function deploymentId(profile: ChatProfile, chatSettings: ChatSettings) {
  switch (chatSettings.model) {
    case "gpt-3.5-turbo":
      return profile.azure_openai_35_turbo_id || ""
    case "gpt-4-turbo-preview":
      return profile.azure_openai_45_turbo_id || ""
    case "gpt-4-vision-preview":
      return profile.azure_openai_45_vision_id || ""
    default:
      return null
  }
}

export const POST = createChatRoute({
  provider: "Azure OpenAI",
  apiKey: profile => profile.azure_openai_api_key,
  // Runs before the memory lookup, so a misconfigured deployment fails without
  // a round-trip to the database first.
  validate: (profile, chatSettings) => {
    const deployment = deploymentId(profile, chatSettings)

    if (deployment === null) {
      return new Response(JSON.stringify({ message: "Model not found" }), {
        status: 400
      })
    }

    if (!profile.azure_openai_endpoint || !profile.azure_openai_api_key) {
      return new Response(
        JSON.stringify({ message: "Azure resources not found" }),
        { status: 400 }
      )
    }

    if (!deployment) {
      return new Response(
        JSON.stringify({ message: "Azure resources not found" }),
        { status: 400 }
      )
    }

    return undefined
  },
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    const key = profile.azure_openai_api_key || ""
    const deployment = deploymentId(profile, chatSettings) || ""

    const azureOpenai = new OpenAI({
      apiKey: key,
      baseURL: `${profile.azure_openai_endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": "2023-12-01-preview" },
      defaultHeaders: { "api-key": key }
    })

    const response = await azureOpenai.chat.completions.create({
      model: deployment as ChatCompletionCreateParamsBase["model"],
      messages: messages as ChatCompletionCreateParamsBase["messages"],
      temperature: chatSettings.temperature,
      // Same as the OpenAI route: the reply's share of the window, which is
      // what the prompt was already trimmed to leave room for.
      max_tokens: budget.outputTokens,
      stream: true
    })

    return openAIStreamResponse(response, headers)
  }
})
