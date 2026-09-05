import { Tables } from "@/supabase/types"
import { LLM, LLMID, OpenRouterLLM } from "@/types"
import { toast } from "sonner"
import { LLM_LIST_MAP } from "./llm/llm-list"

/**
 * The live catalogue, keyed by provider, as `/api/models` returns it.
 *
 * A provider is present only if it answered with at least one usable model;
 * anything else — no key, a failed request, an unparseable response — leaves
 * it absent, and the caller keeps that provider's static list (ARCH-07).
 */
const fetchProviderCatalogs = async (): Promise<Record<string, LLM[]>> => {
  try {
    const response = await fetch("/api/models")

    if (!response.ok) {
      throw new Error(`Model catalogue is not available.`)
    }

    const data = await response.json()
    return (data?.models as Record<string, LLM[]>) ?? {}
  } catch (error) {
    // Not surfaced to the user: the static lists are a working catalogue, so
    // this degrades to the behaviour the app had before ARCH-07 rather than to
    // an error the user can do nothing about.
    console.warn("Error fetching provider catalogues: " + error)
    return {}
  }
}

export const fetchHostedModels = async (profile: Tables<"profiles">) => {
  try {
    const providers = ["google", "anthropic", "mistral", "groq", "perplexity"]

    if (profile.use_azure_openai) {
      providers.push("azure")
    } else {
      providers.push("openai")
    }

    const [response, liveCatalogs] = await Promise.all([
      fetch("/api/keys"),
      fetchProviderCatalogs()
    ])

    if (!response.ok) {
      throw new Error(`Server is not responding.`)
    }

    const data = await response.json()

    let modelsToAdd: LLM[] = []

    for (const provider of providers) {
      let providerKey: keyof typeof profile

      if (provider === "google") {
        providerKey = "google_gemini_api_key"
      } else if (provider === "azure") {
        providerKey = "azure_openai_api_key"
      } else {
        providerKey = `${provider}_api_key` as keyof typeof profile
      }

      if (profile?.[providerKey] || data.isUsingEnvKeyMap[provider]) {
        // What the provider says it serves today, and only otherwise what the
        // static list said it served in May 2024.
        const live = liveCatalogs[provider]
        const models =
          Array.isArray(live) && live.length > 0 ? live : LLM_LIST_MAP[provider]

        if (Array.isArray(models)) {
          modelsToAdd.push(...models)
        }
      }
    }

    return {
      envKeyMap: data.isUsingEnvKeyMap,
      hostedModels: modelsToAdd
    }
  } catch (error) {
    console.warn("Error fetching hosted models: " + error)
  }
}

export const fetchOllamaModels = async () => {
  try {
    const response = await fetch(
      process.env.NEXT_PUBLIC_OLLAMA_URL + "/api/tags"
    )

    if (!response.ok) {
      throw new Error(`Ollama server is not responding.`)
    }

    const data = await response.json()

    const localModels: LLM[] = data.models.map((model: any) => ({
      modelId: model.name as LLMID,
      modelName: model.name,
      provider: "ollama",
      hostedId: model.name,
      platformLink: "https://ollama.ai/library",
      imageInput: false
    }))

    return localModels
  } catch (error) {
    console.warn("Error fetching Ollama models: " + error)
  }
}

export const fetchOpenRouterModels = async () => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models")

    if (!response.ok) {
      throw new Error(`OpenRouter server is not responding.`)
    }

    const { data } = await response.json()

    const openRouterModels = data.map(
      (model: {
        id: string
        name: string
        context_length: number
      }): OpenRouterLLM => ({
        modelId: model.id as LLMID,
        modelName: model.name || model.id,
        provider: "openrouter",
        hostedId: model.id,
        platformLink: "https://openrouter.dev",
        imageInput: false,
        maxContext: model.context_length
      })
    )

    return openRouterModels
  } catch (error) {
    console.error("Error fetching Open Router models: " + error)
    toast.error("Error fetching Open Router models: " + error)
  }
}
