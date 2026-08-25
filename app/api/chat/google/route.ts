import { createChatRoute } from "@/lib/server/chat-route"
import { googleStreamResponse } from "@/lib/server/streaming"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const runtime = "edge"

export const POST = createChatRoute({
  provider: "Google Gemini",
  apiKey: profile => profile.google_gemini_api_key,
  // Gemini takes `parts`, not OpenAI content blocks, so memory is injected into
  // the adapted first message instead.
  format: "google",
  // Gemini words a bad key its own way, and does not use a 401 for it.
  incorrectKey: { kind: "message", contains: "api key not valid" },
  respond: async ({ profile, chatSettings, messages, headers }) => {
    const genAI = new GoogleGenerativeAI(profile.google_gemini_api_key || "")
    const googleModel = genAI.getGenerativeModel({ model: chatSettings.model })

    // The current turn is sent on its own; everything before it is history.
    const history = [...messages]
    const lastMessage = history.pop()

    const chat = googleModel.startChat({
      history,
      generationConfig: {
        temperature: chatSettings.temperature
      }
    })

    const response = await chat.sendMessageStream(lastMessage.parts)

    return googleStreamResponse(response.stream, headers)
  }
})
