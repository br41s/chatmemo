import { createChatRoute } from "@/lib/server/chat-route"
import { anthropicStreamResponse } from "@/lib/server/streaming"
import { getBase64FromDataURL, getMediaTypeFromDataURL } from "@/lib/utils"
import Anthropic from "@anthropic-ai/sdk"

export const runtime = "edge"

/**
 * OpenAI content blocks to Anthropic ones.
 *
 * Anthropic wants every message's content as an array of typed blocks, and
 * images as base64 with an explicit media type rather than a data URL.
 */
function toAnthropicMessages(messages: any[]) {
  return messages.map((message: any) => {
    const content =
      typeof message?.content === "string"
        ? [message.content]
        : message?.content

    return {
      ...message,
      content: content.map((block: any) => {
        if (typeof block === "string") {
          return { type: "text", text: block }
        }

        if (block?.type === "image_url" && block?.image_url?.url?.length) {
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: getMediaTypeFromDataURL(block.image_url.url),
              data: getBase64FromDataURL(block.image_url.url)
            }
          }
        }

        return block
      })
    }
  })
}

export const POST = createChatRoute({
  provider: "Anthropic",
  apiKey: profile => profile.anthropic_api_key,
  respond: async ({ profile, chatSettings, messages, headers, budget }) => {
    const anthropic = new Anthropic({
      apiKey: profile.anthropic_api_key || ""
    })

    // Memory was injected into the system message, which Anthropic takes as its
    // own field rather than as the first message.
    const response = await anthropic.messages.create({
      model: chatSettings.model,
      messages: toAnthropicMessages(messages.slice(1)),
      temperature: chatSettings.temperature,
      system: messages[0].content,
      max_tokens: budget.outputTokens,
      stream: true
    })

    return anthropicStreamResponse(response, headers)
  }
})
