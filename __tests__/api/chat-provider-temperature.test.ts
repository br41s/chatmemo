/**
 * @jest-environment node
 */
import { POST as groq } from "../../app/api/chat/groq/route"
import { POST as mistral } from "../../app/api/chat/mistral/route"
import { POST as perplexity } from "../../app/api/chat/perplexity/route"

// These three routes were inherited without `temperature`, so the setting the
// user chose was silently replaced by each provider's default.

const create = jest.fn()

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn(() => ({ chat: { completions: { create } } }))
}))

jest.mock("../../lib/server/server-chat-helpers", () => ({
  getServerProfile: jest.fn(async () => ({
    user_id: "user-1",
    groq_api_key: "k",
    mistral_api_key: "k",
    perplexity_api_key: "k"
  })),
  checkApiKey: jest.fn()
}))

jest.mock("../../lib/server/inject-memory", () => ({
  injectMemoryOpenAIFormat: jest.fn(async (messages: unknown) => ({
    messages,
    report: {}
  }))
}))

jest.mock("../../lib/server/memory-report-headers", () => ({
  memoryReportHeaders: jest.fn(() => ({}))
}))

jest.mock("../../lib/server/streaming", () => ({
  openAIStreamResponse: jest.fn(() => new Response("stream"))
}))

beforeEach(() => create.mockReset().mockResolvedValue({}))

it.each([
  ["groq", groq],
  ["mistral", mistral],
  ["perplexity", perplexity]
])("%s sends the chosen temperature", async (_name, POST) => {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chatSettings: { model: "some-model", temperature: 0.2 },
        messages: [{ role: "user", content: "hi" }]
      })
    })
  )

  expect(response.status).toBe(200)
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0.2 })
  )
})
