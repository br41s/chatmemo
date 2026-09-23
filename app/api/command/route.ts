import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { providerErrorResponse, readJsonBody } from "@/lib/server/http-error"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import OpenAI from "openai"

export const runtime = "edge"

export async function POST(request: Request) {
  try {
    const { input } = await readJsonBody<{ input: string }>(request)

    const profile = await getServerProfile()

    checkApiKey(profile.openai_api_key, "OpenAI")

    const openai = new OpenAI({
      apiKey: profile.openai_api_key || "",
      organization: profile.openai_organization_id
    })

    const response = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: "Respond to the user."
        },
        {
          role: "user",
          content: input
        }
      ],
      temperature: 0,
      max_tokens:
        CHAT_SETTING_LIMITS["gpt-4-turbo-preview"].MAX_TOKEN_OUTPUT_LENGTH
      //   response_format: { type: "json_object" }
      //   stream: true
    })

    const content = response.choices[0].message.content

    return new Response(JSON.stringify({ content }), {
      status: 200
    })
  } catch (error) {
    return providerErrorResponse(error, "OpenAI")
  }
}
