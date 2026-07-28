/** @jest-environment node */

import { POST } from "../../app/api/chat/custom/route"
import { createSafeModelTextStream } from "../../lib/server/safe-model-stream"
import { textStreamResponse } from "../../lib/server/streaming"
import { createClient } from "../../lib/supabase/server"
import { cookies } from "next/headers"

jest.mock("../../lib/server/safe-model-stream", () => {
  const actual = jest.requireActual("../../lib/server/safe-model-stream")
  return {
    ...actual,
    createSafeModelTextStream: jest.fn(),
    logSafeModelFailure: jest.fn()
  }
})
jest.mock("../../lib/server/streaming", () => ({
  textStreamResponse: jest.fn(() => new Response("stream"))
}))
jest.mock("../../lib/supabase/server", () => ({
  createClient: jest.fn()
}))
jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({ session: "cookie-store" }))
}))

const MODEL_ID = "123e4567-e89b-42d3-a456-426614174000"
const OWNER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

const mockCreateSafeModelTextStream = jest.mocked(createSafeModelTextStream)
const mockTextStreamResponse = jest.mocked(textStreamResponse)
const mockCreateClient = jest.mocked(createClient)
const mockCookies = jest.mocked(cookies)

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    customModelId: MODEL_ID,
    temperature: 0.7,
    messages: [{ role: "user", content: "Hello" }],
    ...overrides
  }
}

function createRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/chat/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  })
}

function mockSupabase(options: {
  userId?: string | null
  authError?: unknown
  model?: Record<string, unknown> | null
  modelError?: unknown
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options.model ?? null,
    error: options.modelError ?? null
  })
  const eq = jest.fn(() => ({ maybeSingle }))
  const select = jest.fn(() => ({ eq }))
  const from = jest.fn(() => ({ select }))
  const getUser = jest.fn().mockResolvedValue({
    data: {
      user: options.userId === null ? null : { id: options.userId || OWNER_ID }
    },
    error: options.authError ?? null
  })

  mockCreateClient.mockReturnValue({
    auth: { getUser },
    from
  } as any)

  return { eq, from, getUser, maybeSingle, select }
}

describe("POST /api/chat/custom", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateSafeModelTextStream.mockResolvedValue(
      (async function* () {
        yield "hello"
      })()
    )
  })

  it("rejects unknown client-controlled model configuration", async () => {
    const response = await POST(
      createRequest(validBody({ api_key: "attacker-key" }))
    )

    expect(response.status).toBe(400)
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockCreateSafeModelTextStream).not.toHaveBeenCalled()
  })

  it("rejects invalid UUIDs before authentication", async () => {
    const response = await POST(
      createRequest(validBody({ customModelId: "not-a-uuid" }))
    )

    expect(response.status).toBe(400)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("rejects an oversized body from Content-Length", async () => {
    const response = await POST(
      createRequest(validBody(), { "Content-Length": "2097153" })
    )

    expect(response.status).toBe(413)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("counts a chunked body before parsing when Content-Length is absent", async () => {
    const chunk = new Uint8Array(1024 * 1024 + 1)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      }
    })
    const request = new Request("http://localhost/api/chat/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half"
    } as RequestInit & { duplex: "half" })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("requires an authenticated Supabase session", async () => {
    mockSupabase({ userId: null })

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(401)
    expect(mockCreateSafeModelTextStream).not.toHaveBeenCalled()
  })

  it("accepts the strict legacy payload used by cached clients", async () => {
    mockSupabase({
      userId: OWNER_ID,
      model: {
        id: MODEL_ID,
        user_id: OWNER_ID,
        api_key: "",
        base_url: "https://api.example.com/v1",
        model_id: "stored-model"
      }
    })

    const response = await POST(
      createRequest({
        customModelId: MODEL_ID,
        chatSettings: {
          model: "stored-model",
          prompt: "",
          temperature: 0.4,
          contextLength: 8192,
          includeProfileContext: true,
          includeWorkspaceInstructions: true,
          embeddingsProvider: "openai"
        },
        messages: [{ role: "user", content: "Hello" }]
      })
    )

    expect(response.status).toBe(200)
    expect(mockCreateSafeModelTextStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "stored-model",
        temperature: 0.4
      })
    )
  })

  it("accepts bounded data images produced by buildFinalMessages", async () => {
    mockSupabase({
      userId: OWNER_ID,
      model: {
        id: MODEL_ID,
        user_id: OWNER_ID,
        api_key: "",
        base_url: "https://api.example.com/v1",
        model_id: "stored-model"
      }
    })
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGVsbG8=" }
          }
        ]
      }
    ]

    const response = await POST(createRequest(validBody({ messages })))

    expect(response.status).toBe(200)
    expect(mockCreateSafeModelTextStream).toHaveBeenCalledWith(
      expect.objectContaining({ messages })
    )
  })

  it("returns 403 when RLS does not expose the model", async () => {
    mockSupabase({ userId: OWNER_ID, model: null })

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(403)
    expect(mockCreateSafeModelTextStream).not.toHaveBeenCalled()
  })

  it("defensively rejects a foreign shared row that still contains a key", async () => {
    mockSupabase({
      userId: OWNER_ID,
      model: {
        id: MODEL_ID,
        user_id: OTHER_ID,
        api_key: "other-user-secret",
        base_url: "https://api.example.com/v1",
        model_id: "stored-model"
      }
    })

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(403)
    expect(mockCreateSafeModelTextStream).not.toHaveBeenCalled()
  })

  it("uses only stored configuration for an owner model", async () => {
    const query = mockSupabase({
      userId: OWNER_ID,
      model: {
        id: MODEL_ID,
        user_id: OWNER_ID,
        api_key: "stored-secret",
        base_url: "https://api.example.com/v1",
        model_id: "stored-model"
      }
    })

    const request = createRequest(validBody())
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockCreateClient).toHaveBeenCalledWith(mockCookies())
    expect(query.select).toHaveBeenCalledWith(
      "id, user_id, api_key, base_url, model_id"
    )
    expect(query.eq).toHaveBeenCalledWith("id", MODEL_ID)
    expect(mockCreateSafeModelTextStream).toHaveBeenCalledWith({
      apiKey: "stored-secret",
      baseUrl: "https://api.example.com/v1",
      correlationId: expect.any(String),
      messages: [{ role: "user", content: "Hello" }],
      model: "stored-model",
      signal: request.signal,
      temperature: 0.7
    })
    expect(mockTextStreamResponse).toHaveBeenCalledTimes(1)
  })

  it("allows an authenticated user to execute a shared keyless model", async () => {
    mockSupabase({
      userId: OWNER_ID,
      model: {
        id: MODEL_ID,
        user_id: OTHER_ID,
        api_key: "",
        base_url: "https://public.example.com/v1",
        model_id: "public-model"
      }
    })

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(200)
    expect(mockCreateSafeModelTextStream).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "", model: "public-model" })
    )
  })
})
