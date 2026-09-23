import {
  createOpenAICompatibleRoute,
  limitsMaxTokens
} from "@/lib/server/openai-compatible-route"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "edge"

export const POST = createOpenAICompatibleRoute({
  name: "Mistral",
  apiKey: profile => profile.mistral_api_key,
  baseURL: "https://api.mistral.ai/v1",
  maxTokens: limitsMaxTokens
})
