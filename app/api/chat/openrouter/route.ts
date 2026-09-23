import { createOpenAICompatibleRoute } from "@/lib/server/openai-compatible-route"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "edge"

export const POST = createOpenAICompatibleRoute({
  name: "OpenRouter",
  apiKey: profile => profile.openrouter_api_key,
  baseURL: "https://openrouter.ai/api/v1"
})
