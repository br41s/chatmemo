/**
 * @jest-environment node
 *
 * The text a turn's memory is searched by, read from the messages as sent.
 *
 * The server's injectors and the browser's recall preview both use these, so
 * the preview names what the turn will be given. Each case below is a way the
 * text typed into the composer differs from what the server extracts — the
 * preview used to be sent the former.
 */
import { lastUserTextGoogle, lastUserTextOpenAI } from "@/lib/memory-block"

describe("lastUserTextOpenAI", () => {
  it("is the last user message", () => {
    expect(
      lastUserTextOpenAI([
        { role: "system", content: "rules" },
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "what about the Qatar refund?" }
      ])
    ).toBe("what about the Qatar refund?")
  })

  it("on a regeneration is the prompt, not the answer being replaced", () => {
    // The old answer is still the final message of the request.
    expect(
      lastUserTextOpenAI([
        { role: "user", content: "what about the Qatar refund?" },
        { role: "assistant", content: "The previous answer, about paella." }
      ])
    ).toBe("what about the Qatar refund?")
  })

  it("includes retrieved file text appended to the message", () => {
    const content = "summarise this\n\nYou may use the following sources…"
    expect(lastUserTextOpenAI([{ role: "user", content }])).toBe(content)
  })

  it("is empty for a message made of content parts", () => {
    // An image message: the server does not search memory by it.
    expect(
      lastUserTextOpenAI([
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: "data:…" } }
          ]
        }
      ])
    ).toBe("")
  })

  it("is empty when the user message did not survive trimming", () => {
    // A message longer than the history budget is dropped before sending.
    expect(lastUserTextOpenAI([{ role: "system", content: "rules" }])).toBe("")
    expect(lastUserTextOpenAI([])).toBe("")
  })
})

describe("lastUserTextGoogle", () => {
  it("joins the text parts of the last message", () => {
    expect(
      lastUserTextGoogle([
        { role: "user", parts: [{ text: "rules" }] },
        { role: "user", parts: [{ text: "Qatar refund" }, { text: "status" }] }
      ])
    ).toBe("Qatar refund status")
  })

  it("is empty without parts", () => {
    expect(lastUserTextGoogle([{ role: "user", content: "x" }])).toBe("")
    expect(lastUserTextGoogle([])).toBe("")
  })
})
