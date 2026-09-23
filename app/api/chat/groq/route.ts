import {
  createOpenAICompatibleRoute,
  limitsMaxTokens
} from "@/lib/server/openai-compatible-route"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "edge"

export const POST = createOpenAICompatibleRoute({
  name: "Groq",
  apiKey: profile => profile.groq_api_key,
  baseURL: "https://api.groq.com/openai/v1",
  maxTokens: limitsMaxTokens
})
