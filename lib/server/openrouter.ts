/**
 * Shared OpenRouter utilities used by all summarisation routes.
 *
 * Single source of truth for:
 *  - model name
 *  - client factory
 *  - callSummarizer (LLM call + SKIP guard)
 *  - resolveOpenRouterKey (profile key > env fallback)
 */

import OpenAI from "openai"
import { checkApiKey } from "@/lib/server/server-chat-helpers"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Tried in order until one answers. The free variant was listed first until
// OpenRouter withdrew it (404 "unavailable for free", 2026-09-29): every
// summary then paid for the fallback anyway, after a request that could only
// fail. Keep in sync with scripts/claude-sessions-shared.mjs.
export const SUMMARIZE_MODELS = ["openai/gpt-oss-120b"]
// Kept as an alias for the primary model for backward compatibility.
export const SUMMARIZE_MODEL = SUMMARIZE_MODELS[0]
export const MIN_SUMMARY_WORDS = 10

// gpt-oss reasons before it answers, and on OpenRouter those reasoning tokens
// count against max_tokens. Callers size max_tokens for the summary alone, so
// on a long transcript the reasoning could spend all of it and leave no
// answer — which read as "nothing worth remembering" and dropped the
// conversation. Low effort keeps the reasoning short; the headroom keeps it
// from eating the caller's allowance.
export const REASONING_EFFORT = "low"
export const REASONING_HEADROOM_TOKENS = 2_000

/** An answer cut off before any text: a failure, not an empty summary. */
export class SummaryCutOffError extends Error {
  constructor(model: string, usage: unknown) {
    super(
      `summariser ${model} hit its token limit before writing any text (usage ${JSON.stringify(
        usage ?? null
      )})`
    )
    this.name = "SummaryCutOffError"
  }
}
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createOpenRouterClient(
  apiKey: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: timeoutMs
  })
}

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/**
 * Returns the OpenRouter API key from the user profile (first) or the
 * server-side env var (fallback). Calls checkApiKey which throws a formatted
 * error if no key is found — so callers don't need a null check afterwards.
 */
export function resolveOpenRouterKey(profile: {
  openrouter_api_key?: string | null
}): string {
  const key =
    profile.openrouter_api_key || process.env.OPENROUTER_API_KEY || null
  checkApiKey(key, "OpenRouter")
  return key as string
}

// ---------------------------------------------------------------------------
// Summarizer
// ---------------------------------------------------------------------------

export interface SummarizerResult {
  /** Trimmed output, or null for an empty/SKIP/too-short result. */
  text: string | null
  /**
   * The model stopped because it hit max_tokens rather than finishing.
   *
   * Matters for any caller that REPLACES a stored document with the output:
   * a truncated rewrite looks like a valid shorter document, and writing it
   * destroys whatever the model had not got to yet.
   */
  truncated: boolean
}

/**
 * Calls the summarisation model and reports both the text and whether the
 * model ran out of room.
 */
export async function callSummarizerWithMeta(
  client: OpenAI,
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 700
): Promise<SummarizerResult> {
  let lastError: unknown
  for (const model of SUMMARIZE_MODELS) {
    try {
      // `reasoning` is OpenRouter's parameter, not the OpenAI SDK's; the SDK
      // sends the body as given.
      const params = {
        model,
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent }
        ],
        temperature: 0.3,
        max_tokens: maxTokens + REASONING_HEADROOM_TOKENS,
        reasoning: { effort: REASONING_EFFORT },
        stream: false as const
      }
      const completion = await client.chat.completions.create(params)

      const choice = completion.choices[0]
      const text = (choice?.message?.content ?? "").trim()
      const truncated = choice?.finish_reason === "length"

      if (!text && truncated) {
        // Not "nothing worth remembering": the model never got to answer.
        // Thrown so callers log it and retry instead of recording a skip.
        throw new SummaryCutOffError(model, completion.usage)
      }

      if (
        !text ||
        text === "SKIP" ||
        text.split(/\s+/).length < MIN_SUMMARY_WORDS
      ) {
        // Valid empty/SKIP result — not a failure, so don't try the fallback.
        return { text: null, truncated }
      }

      return { text, truncated }
    } catch (error) {
      lastError = error
      console.error(
        `callSummarizer: model ${model} failed — ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  // Every model failed — rethrow so the caller's error handling (e.g. the
  // 429 rate-limit messaging in the import route) still applies.
  throw lastError
}

/**
 * Text-only wrapper for callers that append their output rather than replacing
 * a document, and so cannot be harmed by a truncated result.
 */
export async function callSummarizer(
  client: OpenAI,
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 700
): Promise<string | null> {
  const { text } = await callSummarizerWithMeta(
    client,
    systemPrompt,
    userContent,
    maxTokens
  )
  return text
}
