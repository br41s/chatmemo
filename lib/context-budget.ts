// One budget for everything that competes for the model's context window.
//
// There used to be two, and they did not know about each other. The client
// trimmed conversation history to `chatSettings.contextLength` — 4096 by
// default — and the server then prepended the memory block to the system
// message: up to 100k chars of baseline, 6k of relevance, or 120k of verbatim
// transcript on a full-conversation hit. So a request budgeted at ~4k tokens
// went out carrying ~30k, the user's context-length setting described nothing
// that was actually sent, and a model with a small window returned a provider
// 400 that surfaced as a generic chat failure.
//
// Now one function resolves the split, from the model's real window, and both
// sides read it. The client trims history to its share; the server sizes each
// memory layer to its share.
//
// Deliberately unchanged for large-window models: at the default settings on a
// 128k model, the memory allowance still resolves to the same 100k-char
// ceiling the layers used before, so this bounds the request without shrinking
// what a capable model receives. Small windows are where behaviour changes,
// and there it changes from overflowing to fitting.

/** Rough bytes-per-token for English prose. Only used to turn a token
 *  allowance into a char budget for the memory layers, which measure in
 *  characters; deliberately conservative so the estimate over-reserves. */
export const CHARS_PER_TOKEN = 4

/** Assumed window when the model is unknown — an OpenRouter model missing from
 *  the catalogue, a custom endpoint, an Ollama tag. Low enough to be safe. */
export const DEFAULT_WINDOW_TOKENS = 8_192

/** Nothing useful happens below this, and it guards against a client sending
 *  a nonsensical window. */
export const MIN_WINDOW_TOKENS = 2_048

/** Upper clamp on a client-supplied window, so a bad value cannot talk the
 *  server into assembling an unbounded memory block. */
export const MAX_WINDOW_TOKENS = 2_000_000

/** Ceiling on the memory block regardless of how large the window is. Matches
 *  the sum of the previous hardcoded layer budgets (80k personal + 20k bulk),
 *  so a big model sees exactly what it saw before. */
export const MAX_MEMORY_CHARS = 100_000

/** Default reply reservation when the model's own limit is unknown. */
export const DEFAULT_OUTPUT_TOKENS = 4_096

/** The reply may never claim more than this share of the window. */
const MAX_OUTPUT_SHARE = 0.25

/** History may never claim more than this share of what is left after the
 *  reply, so there is always room for memory to say something. */
const MAX_HISTORY_SHARE = 0.5

// Layer shares, as fractions of the memory allowance. These reproduce the
// previous fixed constants at the default allowance.
const PERSONAL_SHARE = 0.8
const BULK_SHARE = 0.2
const RELEVANT_SHARE = 0.06

/** A full-conversation hit drops the baseline and relevance layers, so the
 *  transcript may exceed the steady-state memory share. 1.2 reproduces the
 *  previous 120k cap against the previous 100k baseline. */
const FULL_CONVERSATION_SHARE = 1.2

export interface ContextBudget {
  /** The window the split was computed against. */
  windowTokens: number
  /** Held back for the model's reply. */
  outputTokens: number
  /** What conversation history may occupy. The client trims to this. */
  historyTokens: number
  /** What the whole memory block may occupy. */
  memoryChars: number
  /** Per-layer char allowances, derived from memoryChars. */
  personalChars: number
  bulkChars: number
  relevantChars: number
  fullConversationChars: number
}

export interface ContextBudgetInput {
  /** The model's real context window, when known. */
  windowTokens?: number | null
  /** The user's context-length setting — a cap on history, not on the total. */
  requestedHistoryTokens?: number | null
  /** The model's max output length, when known. */
  outputTokens?: number | null
}

function clampInt(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const truncated = Math.trunc(value)
  if (truncated < min) return fallback
  return Math.min(truncated, max)
}

/**
 * Split a model's context window between the reply, the conversation and the
 * memory block.
 *
 * Every input is optional and every bad input falls back to a safe value, so
 * this is equally usable on the client (where the model is known) and on the
 * server (where the numbers arrive over the wire and must not be trusted).
 */
export function resolveContextBudget(
  input: ContextBudgetInput = {}
): ContextBudget {
  const windowTokens = clampInt(
    input.windowTokens,
    DEFAULT_WINDOW_TOKENS,
    MIN_WINDOW_TOKENS,
    MAX_WINDOW_TOKENS
  )

  const outputTokens = Math.min(
    clampInt(input.outputTokens, DEFAULT_OUTPUT_TOKENS, 1, windowTokens),
    Math.floor(windowTokens * MAX_OUTPUT_SHARE)
  )

  const available = Math.max(windowTokens - outputTokens, 0)

  // The user's setting caps history, but cannot push the request past the
  // window or starve memory entirely.
  const requested = clampInt(
    input.requestedHistoryTokens,
    available,
    1,
    available
  )
  const historyTokens = Math.min(
    requested,
    Math.floor(available * MAX_HISTORY_SHARE)
  )

  const memoryChars = Math.min(
    Math.max(available - historyTokens, 0) * CHARS_PER_TOKEN,
    MAX_MEMORY_CHARS
  )

  return {
    windowTokens,
    outputTokens,
    historyTokens,
    memoryChars,
    personalChars: Math.floor(memoryChars * PERSONAL_SHARE),
    bulkChars: Math.floor(memoryChars * BULK_SHARE),
    relevantChars: Math.floor(memoryChars * RELEVANT_SHARE),
    fullConversationChars: Math.floor(memoryChars * FULL_CONVERSATION_SHARE)
  }
}

/** Wire shape: what the client tells the server about the chosen model. The
 *  server re-resolves rather than trusting the split itself. */
export interface ContextBudgetHint {
  windowTokens?: number | null
  requestedHistoryTokens?: number | null
  outputTokens?: number | null
}
