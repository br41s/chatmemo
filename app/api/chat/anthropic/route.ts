import { providerErrorResponse, readJsonBody } from "@/lib/server/http-error"
import { limitsMaxTokens } from "@/lib/server/openai-compatible-route"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { injectMemoryOpenAIFormat } from "@/lib/server/inject-memory"
import { getBase64FromDataURL, getMediaTypeFromDataURL } from "@/lib/utils"
import { ChatSettings } from "@/types"
import Anthropic from "@anthropic-ai/sdk"
import { anthropicStreamResponse } from "@/lib/server/streaming"
import { NextRequest } from "next/server"

export const runtime = "edge"

export async function POST(request: NextRequest) {
  try {
    const { chatSettings, messages } = await readJsonBody<{
      chatSettings: ChatSettings
      messages: any[]
    }>(request)

    const profile = await getServerProfile()

    checkApiKey(profile.anthropic_api_key, "Anthropic")

    // Inject memory into the system message (index 0) before splitting it off
    // from the conversation messages below.
    const augmentedMessages = await injectMemoryOpenAIFormat(
      messages,
      profile.user_id
    )

    let ANTHROPIC_FORMATTED_MESSAGES: any = augmentedMessages.slice(1)

    ANTHROPIC_FORMATTED_MESSAGES = ANTHROPIC_FORMATTED_MESSAGES?.map(
      (message: any) => {
        const messageContent =
          typeof message?.content === "string"
            ? [message.content]
            : message?.content

        return {
          ...message,
          content: messageContent.map((content: any) => {
            if (typeof content === "string") {
              // Handle the case where content is a string
              return { type: "text", text: content }
            } else if (
              content?.type === "image_url" &&
              content?.image_url?.url?.length
            ) {
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: getMediaTypeFromDataURL(content.image_url.url),
                  data: getBase64FromDataURL(content.image_url.url)
                }
              }
            } else {
              return content
            }
          })
        }
      }
    )

    const anthropic = new Anthropic({
      apiKey: profile.anthropic_api_key || ""
    })

    const response = await anthropic.messages.create({
      model: chatSettings.model,
      messages: ANTHROPIC_FORMATTED_MESSAGES,
      temperature: chatSettings.temperature,
      system: augmentedMessages[0].content,
      // Anthropic requires max_tokens; 4096 is every listed Claude model's cap.
      max_tokens: limitsMaxTokens(chatSettings.model) ?? 4096,
      stream: true
    })

    return anthropicStreamResponse(response)
  } catch (error) {
    return providerErrorResponse(error, "Anthropic")
  }
}
