import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { ContextBudgetHint } from "@/lib/context-budget"
import { CatalogModel } from "@/lib/models/provider-catalog"
import { LLM, LLMID, OpenRouterLLM } from "@/types"

/**
 * What the client knows about the chosen model's real context window, so the
 * server can size the memory block to it.
 *
 * Anything the three sources below cannot place — a custom OpenAI-compatible
 * endpoint, an Ollama tag — returns no window, and the server falls back to
 * its conservative default. That is the honest answer: guessing high for an
 * unknown model is what produced over-limit requests in the first place.
 *
 * The sources, in order of how much they can be trusted:
 *
 *   1. the provider's own catalogue, fetched at sign-in (ARCH-07). Groq,
 *      Mistral and Google report their real limits, so a model they serve
 *      today is budgeted against the window it actually has.
 *   2. CHAT_SETTING_LIMITS, the built-in table. Still correct for the models
 *      it covers, and the only source for the providers that publish no
 *      catalogue — Perplexity, Azure — and for Anthropic, which publishes one
 *      without limits in it.
 *   3. the OpenRouter catalogue's `maxContext`.
 *
 * The live catalogue is consulted first for the window and last for nothing
 * else: a provider that reports no limits contributes no hint, and the lookup
 * falls through to the table rather than inventing a number.
 */
/**
 * Reply reservation for an OpenRouter model.
 *
 * Its catalogue gives a window but no reply limit, so these fell to the 4 096
 * default — and many of its models reason first, with the reasoning counted
 * against that same limit. gpt-oss-120b, answering from a recovered transcript,
 * spent most of it thinking and stopped mid-sentence after ~250 words.
 *
 * The resolver still clamps this to a quarter of the window, so a small model
 * is unaffected, and on a large one the memory block — capped at
 * MAX_MEMORY_CHARS — loses nothing: 131k − 16k leaves far more than it uses.
 */
export const OPENROUTER_OUTPUT_TOKENS = 16_384

export function resolveModelWindow(
  modelId: string,
  availableOpenRouterModels: OpenRouterLLM[] = [],
  requestedHistoryTokens?: number | null,
  availableHostedModels: LLM[] = []
): ContextBudgetHint {
  const live = availableHostedModels.find(
    model => model.modelId === modelId
  ) as CatalogModel | undefined
  const builtIn = CHAT_SETTING_LIMITS[modelId as LLMID]

  if (live?.maxContext) {
    return {
      windowTokens: live.maxContext,
      // A provider that reports a window may still not report a reply limit;
      // the table is the next-best answer, and the budget resolver clamps to a
      // safe share of the window when neither knows.
      outputTokens: live.maxOutput ?? builtIn?.MAX_TOKEN_OUTPUT_LENGTH,
      requestedHistoryTokens
    }
  }

  if (builtIn) {
    return {
      windowTokens: builtIn.MAX_CONTEXT_LENGTH,
      outputTokens: builtIn.MAX_TOKEN_OUTPUT_LENGTH,
      requestedHistoryTokens
    }
  }

  const openRouter = availableOpenRouterModels.find(
    model => model.modelId === modelId
  )
  if (openRouter?.maxContext) {
    return {
      windowTokens: openRouter.maxContext,
      outputTokens: OPENROUTER_OUTPUT_TOKENS,
      requestedHistoryTokens
    }
  }

  return { requestedHistoryTokens }
}

/** Narrowing helper for the mixed model list the chat handler assembles. */
export function isOpenRouterModel(model: LLM): model is OpenRouterLLM {
  return (model as OpenRouterLLM).maxContext !== undefined
}
