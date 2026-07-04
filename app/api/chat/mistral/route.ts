import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { injectMemoryOpenAIFormat } from "@/lib/server/inject-memory"
import { ChatSettings } from "@/types"
import { openAIStreamResponse } from "@/lib/server/streaming"
import OpenAI from "openai"

export const runtime = "edge"

export async function POST(request: Request) {
  const json = await request.json()
  const { chatSettings, messages } = json as {
    chatSettings: ChatSettings
    messages: any[]
  }

  try {
    const profile = await getServerProfile()

    checkApiKey(profile.mistral_api_key, "Mistral")

    const augmentedMessages = await injectMemoryOpenAIFormat(
      messages,
      profile.user_id
    )

    // Mistral is compatible the OpenAI SDK
    const mistral = new OpenAI({
      apiKey: profile.mistral_api_key || "",
      baseURL: "https://api.mistral.ai/v1"
    })

    const response = await mistral.chat.completions.create({
      model: chatSettings.model,
      messages: augmentedMessages,
      max_tokens:
        CHAT_SETTING_LIMITS[chatSettings.model].MAX_TOKEN_OUTPUT_LENGTH,
      stream: true
    })

    return openAIStreamResponse(response)
  } catch (error: any) {
    let errorMessage = error.message || "An unexpected error occurred"
    const errorCode = error.status || 500

    if (errorMessage.toLowerCase().includes("api key not found")) {
      errorMessage =
        "Mistral API Key not found. Please set it in your profile settings."
    } else if (errorCode === 401) {
      errorMessage =
        "Mistral API Key is incorrect. Please fix it in your profile settings."
    }

    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
