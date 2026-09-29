// ---------------------------------------------------------------------------
// Minimal streaming helpers — replacement for OpenAIStream / AnthropicStream /
// StreamingTextResponse from the legacy ai@2.x package.
//
// The client (lib/consume-stream.ts) reads the response body as plain UTF-8
// text, so all a chat route needs is a Response wrapping a text stream. The
// provider chunk shapes are typed structurally so these helpers do not couple
// to a specific openai/@anthropic-ai/sdk version — that coupling is what
// forced the openai package pin under ai@2.x.
//
// Works on both the edge and nodejs runtimes.
// ---------------------------------------------------------------------------

/** Wrap an async iterable of text fragments in a streamed text Response.
 *  `extraHeaders` carries out-of-band metadata about the turn — the memory
 *  report — which cannot ride in a plain text body. */
export function textStreamResponse(
  texts: AsyncIterable<string>,
  extraHeaders?: Record<string, string>
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of texts) {
          if (text) controller.enqueue(encoder.encode(text))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    }
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders
    }
  })
}

// --- OpenAI-compatible chat completion chunks ------------------------------
// Covers OpenAI, OpenRouter, Azure, Groq, Mistral, Perplexity and custom
// OpenAI-compatible endpoints — anything the openai SDK streams.

interface OpenAIChunkLike {
  // role/tool_calls are declared (as unknown) so both real SDK chunks and
  // content-less delta literals stay assignable without an index signature,
  // which interfaces like the SDK's Delta would fail to satisfy.
  choices?: {
    delta?: { content?: string | null; role?: unknown; tool_calls?: unknown }
    finish_reason?: string | null
  }[]
}

/**
 * Appended when the model stopped because it reached the reply limit.
 *
 * Without it a cut-off reply ended exactly like a finished one: a recovered
 * transcript stopped mid-sentence ("PR #72 añadió registro de solicitudes
 * lentas (2") and nothing on screen said anything was missing. Reasoning
 * models make it likelier, since their hidden reasoning counts against the
 * same limit.
 */
export const CUT_OFF_NOTE =
  "\n\n_[Reply cut off: it reached the length limit.]_"

async function* openAIText(
  chunks: AsyncIterable<OpenAIChunkLike>
): AsyncGenerator<string> {
  let cutOff = false
  for await (const chunk of chunks) {
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason === "length") cutOff = true
    yield choice?.delta?.content ?? ""
  }
  if (cutOff) yield CUT_OFF_NOTE
}

export function openAIStreamResponse(
  chunks: AsyncIterable<OpenAIChunkLike>,
  extraHeaders?: Record<string, string>
): Response {
  return textStreamResponse(openAIText(chunks), extraHeaders)
}

// --- Anthropic message stream events ---------------------------------------

interface AnthropicEventLike {
  type: string
  // The SDK's event union carries several delta shapes; keep it opaque here
  // and narrow at the point of use so any SDK version stays assignable.
  delta?: unknown
}

async function* anthropicText(
  events: AsyncIterable<AnthropicEventLike>
): AsyncGenerator<string> {
  let cutOff = false
  for await (const event of events) {
    if (event.type === "message_delta") {
      const delta = event.delta as { stop_reason?: string | null } | undefined
      if (delta?.stop_reason === "max_tokens") cutOff = true
      continue
    }
    if (event.type !== "content_block_delta") continue
    const delta = event.delta as { type?: string; text?: string } | undefined
    if (delta?.type === "text_delta") {
      yield delta.text ?? ""
    }
  }
  if (cutOff) yield CUT_OFF_NOTE
}

export function anthropicStreamResponse(
  events: AsyncIterable<AnthropicEventLike>,
  extraHeaders?: Record<string, string>
): Response {
  return textStreamResponse(anthropicText(events), extraHeaders)
}

// --- Google Gemini content chunks ------------------------------------------

interface GoogleChunkLike {
  text: () => string
}

async function* googleText(
  chunks: AsyncIterable<GoogleChunkLike>
): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    yield chunk.text()
  }
}

export function googleStreamResponse(
  chunks: AsyncIterable<GoogleChunkLike>,
  extraHeaders?: Record<string, string>
): Response {
  return textStreamResponse(googleText(chunks), extraHeaders)
}
