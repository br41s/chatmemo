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

// Primary is the free model; on a hard failure (commonly a free-tier 429) we
// fall back to the paid variant so a single summarise call still succeeds
// instead of failing the whole import. A free-tier rate limit is the most
// common cause of the daemon's "LLM failed" retry storm.
export const SUMMARIZE_MODELS = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-120b"
]
// Kept as an alias for the primary model for backward compatibility.
export const SUMMARIZE_MODEL = SUMMARIZE_MODELS[0]
export const MIN_SUMMARY_WORDS = 10
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
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: false
      })

      const choice = completion.choices[0]
      const text = (choice?.message?.content ?? "").trim()
      const truncated = choice?.finish_reason === "length"

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
