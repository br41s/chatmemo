import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { ContextBudgetHint } from "@/lib/context-budget"
import { LLM, LLMID, OpenRouterLLM } from "@/types"

/**
 * What the client knows about the chosen model's real context window, so the
 * server can size the memory block to it.
 *
 * Two sources, because the app has two kinds of model:
 *   - built-ins, whose limits live in CHAT_SETTING_LIMITS
 *   - OpenRouter models, whose window comes from the fetched catalogue as
 *     `maxContext`
 *
 * Anything else — a custom OpenAI-compatible endpoint, an Ollama tag — returns
 * no window, and the server falls back to its conservative default. That is
 * the honest answer: guessing high for an unknown model is what produced
 * over-limit requests in the first place.
 *
 * Note that CHAT_SETTING_LIMITS only covers the built-in catalogue, which is
 * itself frozen at May 2024 (audit ARCH-07). Refreshing it will improve these
 * numbers; nothing here depends on it being current.
 */
export function resolveModelWindow(
  modelId: string,
  availableOpenRouterModels: OpenRouterLLM[] = [],
  requestedHistoryTokens?: number | null
): ContextBudgetHint {
  const builtIn = CHAT_SETTING_LIMITS[modelId as LLMID]
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
      requestedHistoryTokens
    }
  }

  return { requestedHistoryTokens }
}

/** Narrowing helper for the mixed model list the chat handler assembles. */
export function isOpenRouterModel(model: LLM): model is OpenRouterLLM {
  return (model as OpenRouterLLM).maxContext !== undefined
}
