import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { providerErrorResponse, readJsonBody } from "@/lib/server/http-error"
import { injectMemoryOpenAIFormat } from "@/lib/server/inject-memory"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { openAIStreamResponse } from "@/lib/server/streaming"
import { Tables } from "@/supabase/types"
import { ChatSettings } from "@/types"
import OpenAI from "openai"

type Profile = Tables<"profiles">

interface OpenAICompatibleProvider {
  /** Shown in error messages, e.g. "Groq API Key not found". */
  name: string
  apiKey: (profile: Profile) => string | null
  baseURL?: string
  organization?: (profile: Profile) => string | null
  /** Omitted (undefined) lets the provider use its own default. */
  maxTokens?: (model: string) => number | undefined
}

/** max_tokens from CHAT_SETTING_LIMITS, or the provider default if unknown. */
export function limitsMaxTokens(model: string) {
  return CHAT_SETTING_LIMITS[model as keyof typeof CHAT_SETTING_LIMITS]
    ?.MAX_TOKEN_OUTPUT_LENGTH
}

/** POST handler for providers that speak the OpenAI chat completions API. */
export function createOpenAICompatibleRoute(
  provider: OpenAICompatibleProvider
) {
  return async function POST(request: Request) {
    try {
      const { chatSettings, messages } = await readJsonBody<{
        chatSettings: ChatSettings
        messages: any[]
      }>(request)

      const profile = await getServerProfile()
      const apiKey = provider.apiKey(profile)
      checkApiKey(apiKey, provider.name)

      const augmentedMessages = await injectMemoryOpenAIFormat(
        messages,
        profile.user_id
      )

      const client = new OpenAI({
        apiKey: apiKey || "",
        baseURL: provider.baseURL,
        organization: provider.organization?.(profile)
      })

      const response = await client.chat.completions.create({
        model: chatSettings.model,
        messages: augmentedMessages,
        temperature: chatSettings.temperature,
        max_tokens: provider.maxTokens?.(chatSettings.model),
        stream: true
      })

      return openAIStreamResponse(response)
    } catch (error) {
      return providerErrorResponse(error, provider.name)
    }
  }
}
