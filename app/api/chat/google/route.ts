import { providerErrorResponse, readJsonBody } from "@/lib/server/http-error"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { injectMemoryGoogleFormat } from "@/lib/server/inject-memory"
import { textStreamResponse } from "@/lib/server/streaming"
import { ChatSettings } from "@/types"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const runtime = "edge"

export async function POST(request: Request) {
  try {
    const { chatSettings, messages } = await readJsonBody<{
      chatSettings: ChatSettings
      messages: any[]
    }>(request)

    const profile = await getServerProfile()

    checkApiKey(profile.google_gemini_api_key, "Google")

    const genAI = new GoogleGenerativeAI(profile.google_gemini_api_key || "")
    const googleModel = genAI.getGenerativeModel({ model: chatSettings.model })

    // Inject memory into the first message (adapted system prompt) before the
    // current turn is popped off for sendMessageStream.
    const augmentedMessages = await injectMemoryGoogleFormat(
      messages,
      profile.user_id
    )

    const lastMessage = augmentedMessages.pop()

    const chat = googleModel.startChat({
      history: augmentedMessages,
      generationConfig: {
        temperature: chatSettings.temperature
      }
    })

    const response = await chat.sendMessageStream(lastMessage.parts)

    return textStreamResponse(googleText(response.stream))
  } catch (error) {
    return providerErrorResponse(error, "Google Gemini")
  }
}

async function* googleText(stream: AsyncIterable<{ text: () => string }>) {
  for await (const chunk of stream) {
    yield chunk.text()
  }
}
