/**
 * @jest-environment node
 */
import { chatErrorMessage, createChatRoute } from "../../lib/server/chat-route"
import {
  injectMemoryGoogleFormat,
  injectMemoryOpenAIFormat
} from "../../lib/server/inject-memory"
import {
  checkApiKey,
  getServerProfile
} from "../../lib/server/server-chat-helpers"

jest.mock("../../lib/server/server-chat-helpers", () => ({
  getServerProfile: jest.fn(),
  checkApiKey: jest.fn()
}))

jest.mock("../../lib/server/inject-memory", () => ({
  injectMemoryOpenAIFormat: jest.fn(),
  injectMemoryGoogleFormat: jest.fn()
}))

jest.mock("../../lib/server/memory-report-headers", () => ({
  memoryReportHeaders: jest.fn(() => ({ "x-chatmemo-memory": "report" }))
}))

const getServerProfileMock = getServerProfile as jest.Mock
const checkApiKeyMock = checkApiKey as jest.Mock
const injectOpenAIMock = injectMemoryOpenAIFormat as jest.Mock
const injectGoogleMock = injectMemoryGoogleFormat as jest.Mock

const profile = { user_id: "user-1", openai_api_key: "sk-real" }

function request(body: unknown) {
  return new Request("http://localhost/api/chat/test", {
    method: "POST",
    body: JSON.stringify(body)
  })
}

const payload = {
  chatSettings: { model: "gpt-4o", temperature: 0.4 },
  messages: [{ role: "system", content: "base" }],
  contextBudget: { contextLength: 128_000 }
}

beforeEach(() => {
  jest.clearAllMocks()
  getServerProfileMock.mockResolvedValue(profile)
  checkApiKeyMock.mockImplementation(() => undefined)
  injectOpenAIMock.mockResolvedValue({
    messages: [{ role: "system", content: "base + memory" }],
    report: { included: true }
  })
  injectGoogleMock.mockResolvedValue({
    messages: [{ role: "user", parts: [{ text: "hi" }] }],
    report: { included: true }
  })
})

describe("createChatRoute", () => {
  it("checks the key, injects memory, and hands the result to the provider", async () => {
    const respond = jest.fn(async () => new Response("streamed"))

    const POST = createChatRoute({
      provider: "OpenAI",
      apiKey: p => p.openai_api_key,
      respond
    })

    const response = await POST(request(payload))

    expect(response.status).toBe(200)
    expect(checkApiKeyMock).toHaveBeenCalledWith("sk-real", "OpenAI")
    expect(injectOpenAIMock).toHaveBeenCalledWith(
      payload.messages,
      "user-1",
      payload.contextBudget
    )
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        profile,
        chatSettings: payload.chatSettings,
        messages: [{ role: "system", content: "base + memory" }],
        headers: { "x-chatmemo-memory": "report" }
      })
    )
  })

  it("hands the route the reply allowance, not just the messages", async () => {
    // The reason this exists: OpenRouter's route sent no `max_tokens` at all,
    // so it asked to reserve the model's whole window and a key that could not
    // afford all of it was refused outright.
    let seen: number | undefined

    const POST = createChatRoute({
      provider: "OpenRouter",
      apiKey: p => p.openrouter_api_key ?? null,
      respond: async ({ budget }) => {
        seen = budget.outputTokens
        return new Response("streamed")
      }
    })

    await POST(request(payload))

    expect(seen).toBeGreaterThan(0)
    // A quarter of the window, capped — never the whole thing.
    expect(seen).toBeLessThan(payload.contextBudget.contextLength)
  })

  it("uses the Google injector only when the format asks for it", async () => {
    const POST = createChatRoute({
      provider: "Google Gemini",
      apiKey: p => p.google_gemini_api_key ?? null,
      format: "google",
      respond: async () => new Response("streamed")
    })

    await POST(request(payload))

    expect(injectGoogleMock).toHaveBeenCalledTimes(1)
    expect(injectOpenAIMock).not.toHaveBeenCalled()
  })

  it("aborts before any memory work when validation rejects", async () => {
    const respond = jest.fn(async () => new Response("streamed"))

    const POST = createChatRoute({
      provider: "Azure OpenAI",
      apiKey: p => p.azure_openai_api_key ?? null,
      validate: () =>
        new Response(JSON.stringify({ message: "Model not found" }), {
          status: 400
        }),
      respond
    })

    const response = await POST(request(payload))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: "Model not found"
    })
    // The point of running validate first: a misconfigured deployment must not
    // cost a database round-trip.
    expect(injectOpenAIMock).not.toHaveBeenCalled()
    expect(respond).not.toHaveBeenCalled()
  })

  it("names the provider when the key is missing", async () => {
    checkApiKeyMock.mockImplementation(() => {
      throw new Error("OpenAI API Key not found")
    })

    const POST = createChatRoute({
      provider: "OpenAI",
      apiKey: p => p.openai_api_key,
      respond: async () => new Response("streamed")
    })

    const response = await POST(request(payload))

    await expect(response.json()).resolves.toEqual({
      message:
        "OpenAI API Key not found. Please set it in your profile settings."
    })
  })

  it("surfaces a provider error the provider's own way", async () => {
    const POST = createChatRoute({
      provider: "Groq",
      apiKey: p => p.groq_api_key ?? null,
      respond: async () => {
        throw Object.assign(new Error("Unauthorized"), { status: 401 })
      }
    })

    const response = await POST(request(payload))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      message:
        "Groq API Key is incorrect. Please fix it in your profile settings."
    })
  })
})

describe("chatErrorMessage", () => {
  it("recognises a missing key whatever the provider", () => {
    expect(
      chatErrorMessage("Mistral", new Error("Mistral API Key not found"))
    ).toEqual({
      message:
        "Mistral API Key not found. Please set it in your profile settings.",
      status: 500
    })
  })

  it("recognises a wrong key from the status by default", () => {
    expect(
      chatErrorMessage(
        "Perplexity",
        Object.assign(new Error("nope"), { status: 401 })
      ).message
    ).toBe(
      "Perplexity API Key is incorrect. Please fix it in your profile settings."
    )
  })

  it("recognises a wrong key from the message when that is how it arrives", () => {
    // OpenAI returns the reason in the body and Gemini words it differently
    // again; a status check alone would miss both.
    expect(
      chatErrorMessage("OpenAI", new Error("Incorrect API key provided"), {
        kind: "message",
        contains: "incorrect api key"
      }).message
    ).toBe(
      "OpenAI API Key is incorrect. Please fix it in your profile settings."
    )

    expect(
      chatErrorMessage("Google Gemini", new Error("API key not valid"), {
        kind: "message",
        contains: "api key not valid"
      }).message
    ).toBe(
      "Google Gemini API Key is incorrect. Please fix it in your profile settings."
    )
  })

  it("does not claim a bad key for a provider that gives no such signal", () => {
    expect(
      chatErrorMessage(
        "OpenRouter",
        Object.assign(new Error("rate limited"), { status: 429 }),
        { kind: "none" }
      )
    ).toEqual({ message: "rate limited", status: 429 })
  })

  it("reads the message out of a nested SDK error", () => {
    // Azure's SDK puts it one level down, which is why that route used to read
    // `error.error?.message` and lose every plain Error thrown before the call.
    expect(
      chatErrorMessage("Azure OpenAI", {
        error: { message: "deployment gone" }
      }).message
    ).toBe("deployment gone")
  })

  it("passes an unrecognised failure through as the provider worded it", () => {
    expect(
      chatErrorMessage(
        "OpenAI",
        Object.assign(new Error("context length exceeded"), { status: 400 })
      )
    ).toEqual({ message: "context length exceeded", status: 400 })
  })
})
