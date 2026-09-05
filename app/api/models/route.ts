import { ANTHROPIC_LLM_LIST } from "@/lib/models/llm/anthropic-llm-list"
import { GOOGLE_LLM_LIST } from "@/lib/models/llm/google-llm-list"
import { GROQ_LLM_LIST } from "@/lib/models/llm/groq-llm-list"
import { MISTRAL_LLM_LIST } from "@/lib/models/llm/mistral-llm-list"
import { OPENAI_LLM_LIST } from "@/lib/models/llm/openai-llm-list"
import { PERPLEXITY_LLM_LIST } from "@/lib/models/llm/perplexity-llm-list"
import {
  CatalogModel,
  isOpenAIChatModel,
  mapAnthropicModels,
  mapGoogleModels,
  mapOpenAICompatibleModels
} from "@/lib/models/provider-catalog"
import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createResponse } from "@/lib/server/server-utils"
import { LLM } from "@/types"

/**
 * The live model catalogue (ARCH-07).
 *
 * Five of the six directly-integrated providers publish their own model list.
 * This asks each one the user holds a key for, so a model released after the
 * static lists were written shows up without a code change and a retired one
 * stops being offered.
 *
 * Three properties this route has to hold, in order of importance:
 *
 *   1. **It cannot break the picker.** Every provider is fetched independently
 *      and every failure is caught. A provider that errors, times out or
 *      answers with nonsense is simply absent from the response, and the
 *      client keeps that provider's static list.
 *   2. **Keys stay on the server.** This is why the fetch cannot live in
 *      `fetch-models.ts` next to the OpenRouter call, whose endpoint needs no
 *      key at all.
 *   3. **One slow provider cannot hold up the rest.** All six run in parallel
 *      under an individual timeout.
 */

/** Long enough for a cold provider edge, short enough not to stall a page. */
const CATALOG_TIMEOUT_MS = 6_000

interface ProviderResult {
  provider: string
  models?: CatalogModel[]
  error?: string
}

async function fetchJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    // Per-user keys on a shared URL: never let the data cache hold one user's
    // catalogue for another's request.
    cache: "no-store",
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function attempt(
  provider: string,
  load: () => Promise<CatalogModel[]>
): Promise<ProviderResult> {
  try {
    return { provider, models: await load() }
  } catch (error) {
    // Reported, not thrown: the client falls back to the static list for this
    // provider and every other provider still gets its live catalogue.
    return {
      provider,
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}

export async function GET() {
  let profile: Awaited<ReturnType<typeof getServerProfile>>

  try {
    profile = await getServerProfile()
  } catch {
    return createResponse({ message: "Unauthorized" }, 401)
  }

  const tasks: Promise<ProviderResult>[] = []

  const openaiKey = profile.openai_api_key
  if (openaiKey && !profile.use_azure_openai) {
    tasks.push(
      attempt("openai", async () => {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${openaiKey}`
        }
        if (profile.openai_organization_id) {
          headers["OpenAI-Organization"] = profile.openai_organization_id
        }
        const payload = await fetchJson(
          "https://api.openai.com/v1/models",
          headers
        )
        return mapOpenAICompatibleModels(payload, {
          provider: "openai",
          platformLink: "https://platform.openai.com/docs/overview",
          staticList: OPENAI_LLM_LIST,
          filter: isOpenAIChatModel
        })
      })
    )
  }

  const groqKey = profile.groq_api_key
  if (groqKey) {
    tasks.push(
      attempt("groq", async () => {
        const payload = await fetchJson(
          "https://api.groq.com/openai/v1/models",
          { Authorization: `Bearer ${groqKey}` }
        )
        return mapOpenAICompatibleModels(payload, {
          provider: "groq",
          platformLink: "https://groq.com/",
          staticList: GROQ_LLM_LIST
        })
      })
    )
  }

  const mistralKey = profile.mistral_api_key
  if (mistralKey) {
    tasks.push(
      attempt("mistral", async () => {
        const payload = await fetchJson("https://api.mistral.ai/v1/models", {
          Authorization: `Bearer ${mistralKey}`
        })
        return mapOpenAICompatibleModels(payload, {
          provider: "mistral",
          platformLink: "https://mistral.ai/",
          staticList: MISTRAL_LLM_LIST
        })
      })
    )
  }

  const anthropicKey = profile.anthropic_api_key
  if (anthropicKey) {
    tasks.push(
      attempt("anthropic", async () => {
        const payload = await fetchJson(
          "https://api.anthropic.com/v1/models?limit=100",
          {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01"
          }
        )
        return mapAnthropicModels(
          payload,
          ANTHROPIC_LLM_LIST,
          "https://www.anthropic.com/"
        )
      })
    )
  }

  const googleKey = profile.google_gemini_api_key
  if (googleKey) {
    tasks.push(
      attempt("google", async () => {
        const payload = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(googleKey)}`,
          {}
        )
        return mapGoogleModels(
          payload,
          GOOGLE_LLM_LIST,
          "https://ai.google.dev/"
        )
      })
    )
  }

  const perplexityKey = profile.perplexity_api_key
  if (perplexityKey) {
    tasks.push(
      attempt("perplexity", async () => {
        // Best-effort. Perplexity is served through the OpenAI SDK elsewhere in
        // this app, so `/v1/models` is the standard question to ask an
        // OpenAI-compatible API — but Perplexity does not document it, and a
        // 404 here is an ordinary failure that falls back to the static list
        // like any other. Worth attempting because Perplexity's static list is
        // the most stale of the six: every ID in it is retired.
        const payload = await fetchJson("https://api.perplexity.ai/models", {
          Authorization: `Bearer ${perplexityKey}`
        })
        return mapOpenAICompatibleModels(payload, {
          provider: "perplexity",
          platformLink: "https://docs.perplexity.ai/",
          staticList: PERPLEXITY_LLM_LIST
        })
      })
    )
  }

  // Azure serves per-deployment names rather than a catalogue, so it stays on
  // the static list by design.

  const results = await Promise.all(tasks)

  const models: Record<string, LLM[]> = {}
  const errors: Record<string, string> = {}

  for (const result of results) {
    if (result.models && result.models.length > 0) {
      models[result.provider] = result.models
    } else if (result.error) {
      errors[result.provider] = result.error
    }
  }

  return createResponse({ models, errors }, 200)
}
