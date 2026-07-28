/** @jest-environment node */

import { Readable } from "node:stream"
import {
  buildPinnedModelRequestOptions,
  buildSafeModelCompletionUrl,
  buildSafeModelHeaders,
  createSafeModelTextStream,
  resolveSafeModelAddresses,
  SafeModelRequestError
} from "../../lib/server/safe-model-stream"

function mockResponse(
  chunks: Array<string | Buffer>,
  options: {
    contentEncoding?: string
    contentType?: string
    status?: number
  } = {}
) {
  const response = Readable.from(chunks) as any
  response.statusCode = options.status ?? 200
  response.headers = {
    "content-type": options.contentType ?? "text/event-stream",
    ...(options.contentEncoding
      ? { "content-encoding": options.contentEncoding }
      : {})
  }
  response.setTimeout = jest.fn()
  return response
}

async function collect(stream: AsyncIterable<string>) {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe("safe custom model transport", () => {
  it("builds the OpenAI-compatible completion path without changing origin", () => {
    expect(
      buildSafeModelCompletionUrl("https://api.example.com/v1/").toString()
    ).toBe("https://api.example.com/v1/chat/completions")
  })

  it.each([
    "http://api.example.com/v1",
    "https://localhost/v1",
    "https://api.example.com./v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?token=secret",
    "https://api.example.com/v1#fragment"
  ])("rejects unsafe base URL %s", rawUrl => {
    expect(() => buildSafeModelCompletionUrl(rawUrl)).toThrow(
      SafeModelRequestError
    )
  })

  it("rejects a hostname when any DNS answer is non-public", async () => {
    const url = buildSafeModelCompletionUrl("https://api.example.com/v1")

    await expect(
      resolveSafeModelAddresses(url, async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ])
    ).rejects.toMatchObject({ code: "dns_non_public", phase: "dns" })
  })

  it("freezes the selected address and disables connection reuse", () => {
    const url = buildSafeModelCompletionUrl("https://api.example.com/v1")
    const address = { address: "93.184.216.34", family: 4 }
    const options = buildPinnedModelRequestOptions(url, "{}", "secret", address)
    const callback = jest.fn()

    ;(options.lookup as any)("attacker-controlled", { all: false }, callback)

    expect(options.agent).toBe(false)
    expect(options.hostname).toBe("api.example.com")
    expect(options.servername).toBe("api.example.com")
    expect(options.path).toBe("/v1/chat/completions")
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4)
  })

  it("omits Authorization entirely for a keyless shared model", () => {
    expect(buildSafeModelHeaders("{}", "")).not.toHaveProperty("Authorization")
    expect(buildSafeModelHeaders("{}", "secret")).toMatchObject({
      Authorization: "Bearer secret",
      "Accept-Encoding": "identity"
    })
  })

  it("rejects line breaks in a stored API key before building headers", () => {
    expect(() => buildSafeModelHeaders("{}", "secret\r\nX-Evil: true")).toThrow(
      expect.objectContaining({ code: "invalid_api_key" })
    )
  })

  it("rejects an oversized event before the response-wide limit", async () => {
    const response = mockResponse([`data: ${"x".repeat(1024 * 1024 + 1)}`])
    const stream = await createSafeModelTextStream(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        correlationId: "request-id",
        messages: [{ role: "user", content: "Hello" }],
        model: "stored-model",
        temperature: 0.7
      },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ response, dispose: jest.fn() })
      }
    )

    await expect(collect(stream)).rejects.toMatchObject({
      code: "event_too_large"
    })
  })

  it("parses fragmented SSE and stops at DONE", async () => {
    const response = mockResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"del',
      'ta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n'
    ])
    const dispose = jest.fn()
    const transport = jest.fn().mockResolvedValue({ response, dispose })

    const stream = await createSafeModelTextStream(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        correlationId: "request-id",
        messages: [{ role: "user", content: "Hello" }],
        model: "stored-model",
        temperature: 0.7
      },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport
      }
    )

    await expect(collect(stream)).resolves.toEqual(["Hel", "lo"])
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith(
      new URL("https://api.example.com/v1/chat/completions"),
      JSON.stringify({
        model: "stored-model",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        stream: true
      }),
      "",
      { address: "93.184.216.34", family: 4 },
      undefined
    )
  })

  it("rejects upstream redirects before exposing a stream", async () => {
    const response = mockResponse([], { status: 302 })
    const dispose = jest.fn()

    await expect(
      createSafeModelTextStream(
        {
          apiKey: "",
          baseUrl: "https://api.example.com/v1",
          correlationId: "request-id",
          messages: [{ role: "user", content: "Hello" }],
          model: "stored-model",
          temperature: 0.7
        },
        {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          transport: async () => ({ response, dispose })
        }
      )
    ).rejects.toMatchObject({ code: "upstream_status", status: 502 })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("rejects compressed upstream responses", async () => {
    const response = mockResponse([], { contentEncoding: "gzip" })

    await expect(
      createSafeModelTextStream(
        {
          apiKey: "",
          baseUrl: "https://api.example.com/v1",
          correlationId: "request-id",
          messages: [{ role: "user", content: "Hello" }],
          model: "stored-model",
          temperature: 0.7
        },
        {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          transport: async () => ({ response, dispose: jest.fn() })
        }
      )
    ).rejects.toMatchObject({ code: "compressed_response", status: 502 })
  })

  it("closes an already-started stream on invalid event JSON", async () => {
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation()
    const response = mockResponse(["data: not-json\n\n"])
    const stream = await createSafeModelTextStream(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        correlationId: "request-id",
        messages: [{ role: "user", content: "Hello" }],
        model: "stored-model",
        temperature: 0.7
      },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ response, dispose: jest.fn() })
      }
    )

    await expect(collect(stream)).rejects.toMatchObject({
      code: "invalid_event_json",
      phase: "stream"
    })
    expect(consoleWarn).toHaveBeenCalledWith("Custom model request failed", {
      correlationId: "request-id",
      phase: "stream",
      code: "invalid_event_json"
    })
    consoleWarn.mockRestore()
  })

  it("rejects a clean EOF that arrives before DONE", async () => {
    const response = mockResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
    ])
    const stream = await createSafeModelTextStream(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        correlationId: "request-id",
        messages: [{ role: "user", content: "Hello" }],
        model: "stored-model",
        temperature: 0.7
      },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ response, dispose: jest.fn() })
      }
    )

    await expect(collect(stream)).rejects.toMatchObject({
      code: "stream_truncated"
    })
  })

  it("stops before transport when cancelled during DNS lookup", async () => {
    const controller = new AbortController()
    const transport = jest.fn()
    const lookup = jest.fn(async () => new Promise<never>(() => undefined))
    const pending = createSafeModelTextStream(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        correlationId: "request-id",
        messages: [{ role: "user", content: "Hello" }],
        model: "stored-model",
        signal: controller.signal,
        temperature: 0.7
      },
      { lookup, transport }
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: "aborted" })
    expect(transport).not.toHaveBeenCalled()
  })
})
