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

/** Wrap an async iterable of text fragments in a streamed text Response. */
export function textStreamResponse(texts: AsyncIterable<string>): Response {
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
    headers: { "Content-Type": "text/plain; charset=utf-8" }
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
  }[]
}

async function* openAIText(
  chunks: AsyncIterable<OpenAIChunkLike>
): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    yield chunk.choices?.[0]?.delta?.content ?? ""
  }
}

export function openAIStreamResponse(
  chunks: AsyncIterable<OpenAIChunkLike>
): Response {
  return textStreamResponse(openAIText(chunks))
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
  for await (const event of events) {
    if (event.type !== "content_block_delta") continue
    const delta = event.delta as { type?: string; text?: string } | undefined
    if (delta?.type === "text_delta") {
      yield delta.text ?? ""
    }
  }
}

export function anthropicStreamResponse(
  events: AsyncIterable<AnthropicEventLike>
): Response {
  return textStreamResponse(anthropicText(events))
}
