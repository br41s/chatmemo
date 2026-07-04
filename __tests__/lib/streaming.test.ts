/**
 * @jest-environment node
 *
 * Tests for lib/server/streaming.ts — the local replacement for
 * OpenAIStream/AnthropicStream/StreamingTextResponse from ai@2.x. Every chat
 * route streams through these helpers, so they must concatenate provider
 * chunks into the exact plain-text body the client reader expects.
 */
import {
  anthropicStreamResponse,
  openAIStreamResponse,
  textStreamResponse
} from "@/lib/server/streaming"

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}

describe("textStreamResponse", () => {
  it("streams text fragments as a plain-text body", async () => {
    const res = textStreamResponse(fromArray(["Hello", " ", "world"]))
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8")
    expect(await res.text()).toBe("Hello world")
  })

  it("skips empty fragments", async () => {
    const res = textStreamResponse(fromArray(["a", "", "b"]))
    expect(await res.text()).toBe("ab")
  })
})

describe("openAIStreamResponse", () => {
  it("extracts delta content from chat completion chunks", async () => {
    const chunks = [
      { choices: [{ delta: { role: "assistant" } }] },
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] }
    ]
    const res = openAIStreamResponse(fromArray(chunks))
    expect(await res.text()).toBe("Hello")
  })

  it("tolerates chunks without choices", async () => {
    const res = openAIStreamResponse(fromArray([{}, { choices: [] }]))
    expect(await res.text()).toBe("")
  })
})

describe("anthropicStreamResponse", () => {
  it("extracts text deltas and ignores other event types", async () => {
    const events = [
      { type: "message_start" },
      { type: "content_block_start" },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Ho" }
      },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "la" }
      },
      {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{}" }
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" }
    ]
    const res = anthropicStreamResponse(fromArray(events))
    expect(await res.text()).toBe("Hola")
  })
})
