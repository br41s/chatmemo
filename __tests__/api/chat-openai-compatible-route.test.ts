/** @jest-environment node */

import { HttpError } from "../../lib/server/http-error"
import { injectMemoryOpenAIFormat } from "../../lib/server/inject-memory"
import {
  createOpenAICompatibleRoute,
  limitsMaxTokens
} from "../../lib/server/openai-compatible-route"
import { getServerProfile } from "../../lib/server/server-chat-helpers"
import OpenAI from "openai"

const mockCreate = jest.fn()

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn(() => ({ chat: { completions: { create: mockCreate } } }))
}))
jest.mock("../../lib/server/server-chat-helpers", () => {
  const actual = jest.requireActual("../../lib/server/server-chat-helpers")
  return { ...actual, getServerProfile: jest.fn() }
})
jest.mock("../../lib/server/inject-memory", () => ({
  injectMemoryOpenAIFormat: jest.fn(async (messages: unknown) => messages)
}))
jest.mock("../../lib/server/streaming", () => ({
  openAIStreamResponse: jest.fn(() => new Response("stream"))
}))

const mockOpenAI = jest.mocked(OpenAI)
const mockGetServerProfile = jest.mocked(getServerProfile)
const mockInjectMemory = jest.mocked(injectMemoryOpenAIFormat)

const POST = createOpenAICompatibleRoute({
  name: "Groq",
  apiKey: profile => profile.groq_api_key,
  baseURL: "https://api.groq.com/openai/v1",
  maxTokens: limitsMaxTokens
})

function request(body: unknown) {
  return new Request("http://localhost/api/chat/groq", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  })
}

function chatBody(model = "llama3-8b-8192") {
  return {
    chatSettings: { model, temperature: 0.3 },
    messages: [{ role: "user", content: "Hi" }]
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetServerProfile.mockResolvedValue({
    user_id: "user-1",
    groq_api_key: "gsk-test"
  } as any)
  mockCreate.mockResolvedValue((async function* () {})())
})

describe("createOpenAICompatibleRoute", () => {
  it("streams with the provider's base URL, temperature and memory", async () => {
    const response = await POST(request(chatBody()))

    expect(response.status).toBe(200)
    expect(mockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "gsk-test",
        baseURL: "https://api.groq.com/openai/v1"
      })
    )
    expect(mockInjectMemory).toHaveBeenCalledWith(chatBody().messages, "user-1")
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "llama3-8b-8192",
        temperature: 0.3,
        max_tokens: limitsMaxTokens("llama3-8b-8192"),
        stream: true
      })
    )
  })

  it("leaves max_tokens to the provider for a model missing from the limits", async () => {
    const response = await POST(request(chatBody("brand-new-model")))

    expect(response.status).toBe(200)
    expect(mockCreate.mock.calls[0][0].max_tokens).toBeUndefined()
  })

  it("rejects a malformed body with 400 before touching the profile", async () => {
    const response = await POST(request("{not json"))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: "Request body must be valid JSON"
    })
    expect(mockGetServerProfile).not.toHaveBeenCalled()
  })

  it("returns 401 when there is no session", async () => {
    mockGetServerProfile.mockRejectedValue(
      new HttpError("Authentication required", 401)
    )

    const response = await POST(request(chatBody()))

    expect(response.status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("names the provider when its API key is missing", async () => {
    mockGetServerProfile.mockResolvedValue({
      user_id: "user-1",
      groq_api_key: ""
    } as any)

    const response = await POST(request(chatBody()))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: "Groq API Key not found. Please set it in your profile settings."
    })
  })
})
