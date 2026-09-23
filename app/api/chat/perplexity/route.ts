import { createOpenAICompatibleRoute } from "@/lib/server/openai-compatible-route"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "edge"

export const POST = createOpenAICompatibleRoute({
  name: "Perplexity",
  apiKey: profile => profile.perplexity_api_key,
  baseURL: "https://api.perplexity.ai/"
})
