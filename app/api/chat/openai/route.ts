import { createOpenAICompatibleRoute } from "@/lib/server/openai-compatible-route"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "edge"

export const POST = createOpenAICompatibleRoute({
  name: "OpenAI",
  apiKey: profile => profile.openai_api_key,
  organization: profile => profile.openai_organization_id,
  maxTokens: model =>
    model === "gpt-4-vision-preview" || model === "gpt-4o" ? 4096 : undefined
})
