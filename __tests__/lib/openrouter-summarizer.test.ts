/**
 * @jest-environment node
 */
import {
  callSummarizerWithMeta,
  REASONING_HEADROOM_TOKENS,
  SummaryCutOffError
} from "../../lib/server/openrouter"
import type OpenAI from "openai"

// gpt-oss reasons before answering, and the reasoning counts against
// max_tokens. A cloud session of 45k characters came back as "Nothing worth
// remembering": the reply limit went on reasoning, the answer was empty, and
// empty read as SKIP.

jest.mock("../../lib/server/server-chat-helpers", () => ({
  checkApiKey: jest.fn()
}))

function fakeClient(reply: {
  content: string | null
  finish_reason: string
  usage?: unknown
}) {
  const create = jest.fn(async () => ({
    choices: [
      {
        message: { content: reply.content },
        finish_reason: reply.finish_reason
      }
    ],
    usage: reply.usage
  }))
  const client = { chat: { completions: { create } } } as unknown as OpenAI
  return { client, create }
}

describe("callSummarizerWithMeta", () => {
  it("asks for short reasoning, with headroom above the caller's allowance", async () => {
    const { client, create } = fakeClient({
      content: "- a summary with enough words to count as a real one here",
      finish_reason: "stop"
    })

    await callSummarizerWithMeta(client, "system", "transcript", 900)

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 900 + REASONING_HEADROOM_TOKENS,
        reasoning: { effort: "low" }
      })
    )
  })

  it("fails when the answer was cut off before any text", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {})
    const { client } = fakeClient({
      content: "",
      finish_reason: "length",
      usage: { completion_tokens: 2900 }
    })

    await expect(
      callSummarizerWithMeta(client, "system", "transcript", 900)
    ).rejects.toBeInstanceOf(SummaryCutOffError)
    error.mockRestore()
  })

  it("still reads SKIP as nothing worth remembering", async () => {
    const { client } = fakeClient({ content: "SKIP", finish_reason: "stop" })

    await expect(
      callSummarizerWithMeta(client, "system", "transcript")
    ).resolves.toEqual({ text: null, truncated: false })
  })

  it("keeps a summary that was cut off after it started, flagged as truncated", async () => {
    const text = "- one two three four five six seven eight nine ten eleven"
    const { client } = fakeClient({ content: text, finish_reason: "length" })

    await expect(
      callSummarizerWithMeta(client, "system", "transcript")
    ).resolves.toEqual({ text, truncated: true })
  })
})
