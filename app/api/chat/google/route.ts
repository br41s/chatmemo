import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { ContextBudgetHint } from "@/lib/context-budget"
import { injectMemoryGoogleFormat } from "@/lib/server/inject-memory"
import { ChatSettings } from "@/types"
import { googleStreamResponse } from "@/lib/server/streaming"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const runtime = "edge"

export async function POST(request: Request) {
  const json = await request.json()
  const { chatSettings, messages, contextBudget } = json as {
    chatSettings: ChatSettings
    messages: any[]
    contextBudget?: ContextBudgetHint
  }

  try {
    const profile = await getServerProfile()

    checkApiKey(profile.google_gemini_api_key, "Google")

    const genAI = new GoogleGenerativeAI(profile.google_gemini_api_key || "")
    const googleModel = genAI.getGenerativeModel({ model: chatSettings.model })

    // Inject memory into the first message (adapted system prompt) before the
    // current turn is popped off for sendMessageStream.
    const augmentedMessages = await injectMemoryGoogleFormat(
      messages,
      profile.user_id,
      contextBudget
    )

    const lastMessage = augmentedMessages.pop()

    const chat = googleModel.startChat({
      history: augmentedMessages,
      generationConfig: {
        temperature: chatSettings.temperature
      }
    })

    const response = await chat.sendMessageStream(lastMessage.parts)

    return googleStreamResponse(response.stream)
  } catch (error: any) {
    let errorMessage = error.message || "An unexpected error occurred"
    const errorCode = error.status || 500

    if (errorMessage.toLowerCase().includes("api key not found")) {
      errorMessage =
        "Google Gemini API Key not found. Please set it in your profile settings."
    } else if (errorMessage.toLowerCase().includes("api key not valid")) {
      errorMessage =
        "Google Gemini API Key is incorrect. Please fix it in your profile settings."
    }

    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
