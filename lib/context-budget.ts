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
// 128k model, each layer still resolves to the size it had before, so this
// bounds the request without shrinking what a capable model receives. Small
// windows are where behaviour changes, and there it changes from overflowing
// to fitting.
//
// "Fitting" has to be true of the block that is actually sent, not only of
// the numbers here. For a while it was not: the layer shares added up to 116%
// of the allowance, the lessons document and the instruction text counted
// against nothing, and a recovered transcript was allowed 120% — so an 8k or
// 32k window was handed a block well past the share this function reported
// for it. Every part of the block now has an allowance, and they sum to it.

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

/**
 * Held back from the block for what is in it besides memory: the instruction
 * text, the section tags, and the separators between entries. None of that
 * was counted before, so a block "within" its allowance was already a few
 * thousand characters past it. A test holds this above the real overhead.
 */
export const MEMORY_OVERHEAD_CHARS = 6_000

/**
 * The most the lessons document may take. Lessons counted against nothing,
 * while the rewrite lets the document grow to ~23.7k chars — on a small window
 * that alone was twice the whole allowance. Sized just above that ceiling so
 * a window with room still receives the document whole.
 */
export const MAX_LESSONS_BUDGET_CHARS = 24_000

/** The previous hardcoded layer budgets. They are what a large window still
 *  resolves to, and the proportions a smaller one divides its share in.
 *
 *  The index layer once had none: index rows were injected whole and counted
 *  against nothing, which stopped being survivable when a real import produced
 *  a 58k-char one. It is deliberately small — a date list is high-value per
 *  character for "what was my first X" questions, but it is an index, not
 *  content. */
const MAX_PERSONAL_CHARS = 80_000
const MAX_BULK_CHARS = 20_000
const MAX_INDEX_CHARS = 10_000
const MAX_RELEVANT_CHARS = 6_000
const MAX_LAYER_CHARS =
  MAX_PERSONAL_CHARS + MAX_BULK_CHARS + MAX_INDEX_CHARS + MAX_RELEVANT_CHARS

/** The previous cap on a recovered transcript. */
const MAX_FULL_CONVERSATION_CHARS = 120_000

/**
 * Ceiling on the memory block regardless of how large the window is.
 *
 * It was 100k, described as what the whole block may occupy — but the layers
 * were sized as shares of it that added up to 116%, with lessons and the
 * instructions on top, so a large model was really sent up to ~143k. This is
 * that real total, stated: overhead, lessons and the four layers at their
 * previous sizes. A big model is sent exactly what it was sent before; the
 * number now describes it.
 */
export const MAX_MEMORY_CHARS =
  MEMORY_OVERHEAD_CHARS + MAX_LESSONS_BUDGET_CHARS + MAX_LAYER_CHARS

/** Default reply reservation when the model's own limit is unknown. */
export const DEFAULT_OUTPUT_TOKENS = 4_096

/** The reply may never claim more than this share of the window. */
const MAX_OUTPUT_SHARE = 0.25

/** History may never claim more than this share of what is left after the
 *  reply, so there is always room for memory to say something. */
const MAX_HISTORY_SHARE = 0.5

/** Lessons are the densest signal in the block, so on a small window they may
 *  take up to this much of what is left after the overhead — and no more, or
 *  a long document would leave no room for any conversation at all. */
const LESSONS_MAX_SHARE = 0.3

export interface ContextBudget {
  /** The window the split was computed against. */
  windowTokens: number
  /** Held back for the model's reply. */
  outputTokens: number
  /** What conversation history may occupy. The client trims to this. */
  historyTokens: number
  /** What the whole memory block may occupy — instructions, tags and all. */
  memoryChars: number
  /** Per-layer char allowances. Together with the overhead they sum to no
   *  more than memoryChars, so a block built to them fits. */
  lessonsChars: number
  personalChars: number
  bulkChars: number
  relevantChars: number
  indexChars: number
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

  // What is left for memory itself once the block's own text is paid for.
  const contentChars = Math.max(memoryChars - MEMORY_OVERHEAD_CHARS, 0)
  const lessonsChars = Math.min(
    MAX_LESSONS_BUDGET_CHARS,
    Math.floor(contentChars * LESSONS_MAX_SHARE)
  )
  // The four layers divide the rest in their previous proportions. At the
  // ceiling that is the previous sizes exactly.
  const layerChars = contentChars - lessonsChars
  const layer = (max: number) =>
    Math.floor((layerChars * max) / MAX_LAYER_CHARS)

  return {
    windowTokens,
    outputTokens,
    historyTokens,
    memoryChars,
    lessonsChars,
    personalChars: layer(MAX_PERSONAL_CHARS),
    bulkChars: layer(MAX_BULK_CHARS),
    relevantChars: layer(MAX_RELEVANT_CHARS),
    indexChars: layer(MAX_INDEX_CHARS),
    // A transcript replaces lessons, history and relevance, so it may use
    // everything they would have — not 120% of the block, which is how a
    // recovery request overflowed a window the baseline fitted in.
    fullConversationChars: Math.min(contentChars, MAX_FULL_CONVERSATION_CHARS)
  }
}

/** Wire shape: what the client tells the server about the chosen model. The
 *  server re-resolves rather than trusting the split itself. */
export interface ContextBudgetHint {
  windowTokens?: number | null
  requestedHistoryTokens?: number | null
  outputTokens?: number | null
}
