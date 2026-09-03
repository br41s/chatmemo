import { LLM, LLMID, ModelProvider } from "@/types"

/**
 * Mapping a provider's own model list onto the app's `LLM` shape.
 *
 * ARCH-07: the catalogue under `lib/models/llm/*-llm-list.ts` was written in
 * May 2024 and had no way of learning about anything released since. It still
 * advertised `claude-2.1`, `gpt-4-vision-preview` and the entire retired
 * Perplexity `pplx-*` family — IDs that no longer resolve at their providers —
 * while every model shipped after that date was invisible unless the user went
 * through OpenRouter, whose catalogue *is* fetched.
 *
 * Five of the six directly-integrated providers publish a models endpoint, so
 * the fix is to ask them. The static lists stay, in two reduced roles:
 *
 *   - **fallback**, when a fetch fails or the user has no key. Chat must keep
 *     working when a catalogue request does not.
 *   - **hints**, for the two attributes no provider reports in a form worth
 *     trusting: pricing, and image support where the provider is silent about
 *     it. A live entry inherits those from the static entry with the same ID.
 *
 * The mappers below are deliberately total: every field of every response is
 * treated as optional, an entry that cannot yield an ID is dropped, and a
 * response of an unexpected shape yields an empty list rather than throwing.
 * A provider changing its response shape must not be able to break the model
 * picker, let alone chat.
 */

/** A model as the provider describes it, plus what the static list knows. */
export interface CatalogModel extends LLM {
  /** Context window in tokens, when the provider reports one. */
  maxContext?: number
  /** Longest completion the provider will produce, when it reports one. */
  maxOutput?: number
}

/** The subset of `LLM` the static lists contribute to a live entry. */
type StaticHints = Pick<LLM, "modelName" | "imageInput" | "pricing">

function hintsFor(
  staticList: LLM[],
  modelId: string
): Partial<StaticHints> | undefined {
  const match = staticList.find(model => model.modelId === modelId)
  if (!match) return undefined
  return {
    modelName: match.modelName,
    imageInput: match.imageInput,
    pricing: match.pricing
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const truncated = Math.trunc(value)
  return truncated > 0 ? truncated : undefined
}

/**
 * OpenAI's list is every model on the account — embeddings, speech, image and
 * moderation endpoints included — so it has to be filtered down to the ones
 * that can serve a chat completion. Kept as a denylist of capability words
 * plus an allowlist of family prefixes: a model released tomorrow under a
 * known family appears without a code change, which is the entire point, while
 * `text-embedding-3-large` never reaches the picker.
 */
const OPENAI_CHAT_PREFIXES = ["gpt-", "chatgpt-", "o1", "o3", "o4"]
const NON_CHAT_MARKERS = [
  "embedding",
  "moderation",
  "whisper",
  "tts",
  "dall-e",
  "audio",
  "realtime",
  "transcribe",
  "image",
  "instruct",
  "codex",
  "search",
  "computer-use"
]

export function isOpenAIChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (NON_CHAT_MARKERS.some(marker => id.includes(marker))) return false
  return OPENAI_CHAT_PREFIXES.some(prefix => id.startsWith(prefix))
}

interface OpenAICompatibleOptions {
  provider: ModelProvider
  platformLink: string
  staticList: LLM[]
  /** OpenAI's list needs filtering; Groq's and Mistral's are already chat. */
  filter?: (modelId: string) => boolean
}

/**
 * OpenAI, Groq and Mistral all answer `GET /v1/models` with `{ data: [...] }`
 * and all three key the entry on `id`, so one mapper covers them. They differ
 * only in the extras they attach, and each extra is read where it exists:
 * Groq reports `context_window` and `max_completion_tokens`, Mistral reports
 * `max_context_length` and a `capabilities` object, OpenAI reports neither.
 */
export function mapOpenAICompatibleModels(
  payload: unknown,
  options: OpenAICompatibleOptions
): CatalogModel[] {
  const { provider, platformLink, staticList, filter } = options
  const entries = asArray((payload as { data?: unknown })?.data)

  const models: CatalogModel[] = []

  for (const entry of entries) {
    const row = entry as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : undefined
    if (!id) continue
    if (filter && !filter(id)) continue

    // Groq marks retired models inactive rather than removing them.
    if (row.active === false) continue

    const capabilities = row.capabilities as
      | { completion_chat?: unknown; vision?: unknown }
      | undefined

    // Mistral publishes embedding and OCR models on the same endpoint and
    // distinguishes them here.
    if (capabilities && capabilities.completion_chat === false) continue

    const hints = hintsFor(staticList, id)
    const displayName = typeof row.name === "string" ? row.name : undefined

    models.push({
      modelId: id as LLMID,
      modelName: hints?.modelName ?? displayName ?? id,
      provider,
      hostedId: id,
      platformLink,
      imageInput:
        typeof capabilities?.vision === "boolean"
          ? capabilities.vision
          : hints?.imageInput ?? false,
      ...(hints?.pricing ? { pricing: hints.pricing } : {}),
      maxContext:
        asPositiveInt(row.context_window) ??
        asPositiveInt(row.max_context_length),
      maxOutput: asPositiveInt(row.max_completion_tokens)
    })
  }

  return models
}

/**
 * Anthropic answers `{ data: [{ id, display_name }] }` and reports no limits,
 * so a live entry carries no window and the budget falls back to whatever the
 * static table knows for that ID — or, for a model newer than the table, to
 * the conservative default. Under-reading a 200k window costs memory
 * headroom; guessing one costs a provider 400.
 */
export function mapAnthropicModels(
  payload: unknown,
  staticList: LLM[],
  platformLink: string
): CatalogModel[] {
  const entries = asArray((payload as { data?: unknown })?.data)

  const models: CatalogModel[] = []

  for (const entry of entries) {
    const row = entry as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : undefined
    if (!id) continue

    const hints = hintsFor(staticList, id)
    const displayName =
      typeof row.display_name === "string" ? row.display_name : undefined

    models.push({
      modelId: id as LLMID,
      modelName: hints?.modelName ?? displayName ?? id,
      provider: "anthropic",
      hostedId: id,
      platformLink,
      imageInput: hints?.imageInput ?? false,
      ...(hints?.pricing ? { pricing: hints.pricing } : {})
    })
  }

  return models
}

/**
 * Google answers `{ models: [...] }`, names each model `models/<id>`, and is
 * the only provider here that reports both limits — `inputTokenLimit` and
 * `outputTokenLimit` — which makes its budget the most accurate of the six.
 * Embedding and tuning models appear on the same endpoint and are told apart
 * by `supportedGenerationMethods`.
 */
export function mapGoogleModels(
  payload: unknown,
  staticList: LLM[],
  platformLink: string
): CatalogModel[] {
  const entries = asArray((payload as { models?: unknown })?.models)

  const models: CatalogModel[] = []

  for (const entry of entries) {
    const row = entry as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name : undefined
    if (!name) continue

    const methods = asArray(row.supportedGenerationMethods)
    if (methods.length > 0 && !methods.includes("generateContent")) continue

    const id = name.replace(/^models\//, "")
    if (!id) continue

    const hints = hintsFor(staticList, id)
    const displayName =
      typeof row.displayName === "string" ? row.displayName : undefined

    models.push({
      modelId: id as LLMID,
      modelName: hints?.modelName ?? displayName ?? id,
      provider: "google",
      hostedId: id,
      platformLink,
      imageInput: hints?.imageInput ?? false,
      ...(hints?.pricing ? { pricing: hints.pricing } : {}),
      maxContext: asPositiveInt(row.inputTokenLimit),
      maxOutput: asPositiveInt(row.outputTokenLimit)
    })
  }

  return models
}

/**
 * What a provider returns replaces its static list rather than merging into
 * it, because the retired IDs are the defect: keeping `claude-2.1` around
 * because it is in the static list would preserve exactly what ARCH-07 is
 * about. A provider that answers with nothing usable is treated as not having
 * answered at all, so an empty or unparseable response falls back rather than
 * emptying the picker.
 */
export function catalogForProvider(
  live: CatalogModel[] | undefined,
  staticList: LLM[]
): CatalogModel[] {
  if (!live || live.length === 0) return staticList
  return live
}
