import {
  buildAugmentedGoogleMessages,
  buildAugmentedOpenAIMessages,
  buildMemoryBlock
} from "@/lib/server/inject-memory"

const MEMORY_TAG = "[CHATMEMO_MEMORY]"

describe("buildMemoryBlock", () => {
  it("wraps content in the memory tag and includes the instructions", () => {
    const block = buildMemoryBlock("some summary", null)
    expect(block).toContain(MEMORY_TAG)
    expect(block).toContain("[/CHATMEMO_MEMORY]")
    expect(block).toContain("personal AI assistant")
    expect(block).toContain("some summary")
  })

  it("places the full conversation BEFORE the summary so it cannot be buried", () => {
    const block = buildMemoryBlock("THE_SUMMARY", "THE_FULL_CONVERSATION")
    expect(block.indexOf("THE_FULL_CONVERSATION")).toBeLessThan(
      block.indexOf("THE_SUMMARY")
    )
  })

  it("returns instructions only when there is neither summary nor conversation", () => {
    const block = buildMemoryBlock(null, null)
    expect(block).toContain(MEMORY_TAG)
    expect(block).not.toContain("MEMORY CONTENT")
  })
})

describe("buildAugmentedOpenAIMessages", () => {
  const memoryBlock = buildMemoryBlock("summary text", null)

  it("prepends the memory block to an existing string system message", () => {
    const messages = [
      { role: "system", content: "ORIGINAL_SYSTEM" },
      { role: "user", content: "hi" }
    ]
    const result = buildAugmentedOpenAIMessages(messages, memoryBlock)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("system")
    expect(result[0].content.startsWith(memoryBlock)).toBe(true)
    expect(result[0].content).toContain("ORIGINAL_SYSTEM")
    // conversation messages are untouched
    expect(result[1]).toEqual({ role: "user", content: "hi" })
  })

  it("inserts a new system message when none exists", () => {
    const messages = [{ role: "user", content: "hi" }]
    const result = buildAugmentedOpenAIMessages(messages, memoryBlock)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: "system", content: memoryBlock })
    expect(result[1]).toEqual({ role: "user", content: "hi" })
  })

  it("leaves a system message with non-string (array) content unchanged", () => {
    const messages = [
      { role: "system", content: [{ type: "text", text: "parts" }] },
      { role: "user", content: "hi" }
    ]
    const result = buildAugmentedOpenAIMessages(messages, memoryBlock)
    expect(result).toBe(messages)
  })

  it("is idempotent — a second injection is a no-op", () => {
    const messages = [
      { role: "system", content: "ORIGINAL_SYSTEM" },
      { role: "user", content: "hi" }
    ]
    const once = buildAugmentedOpenAIMessages(messages, memoryBlock)
    const twice = buildAugmentedOpenAIMessages(once, memoryBlock)

    expect(twice).toBe(once)
    // memory tag appears exactly once
    expect(twice[0].content.split(MEMORY_TAG)).toHaveLength(2)
  })
})

describe("buildAugmentedGoogleMessages", () => {
  const memoryBlock = buildMemoryBlock("summary text", null)

  it("prepends the memory block to the first message's first text part", () => {
    const messages = [
      { role: "user", parts: [{ text: "ORIGINAL_SYSTEM" }] },
      { role: "user", parts: [{ text: "hi" }] }
    ]
    const result = buildAugmentedGoogleMessages(messages, memoryBlock)

    expect(result).toHaveLength(2)
    expect(result[0].parts[0].text.startsWith(memoryBlock)).toBe(true)
    expect(result[0].parts[0].text).toContain("ORIGINAL_SYSTEM")
    // the current turn is untouched
    expect(result[1]).toEqual({ role: "user", parts: [{ text: "hi" }] })
  })

  it("preserves additional parts on the first message", () => {
    const messages = [
      {
        role: "user",
        parts: [{ text: "ORIGINAL_SYSTEM" }, { inlineData: { data: "x" } }]
      }
    ]
    const result = buildAugmentedGoogleMessages(messages, memoryBlock)
    expect(result[0].parts).toHaveLength(2)
    expect(result[0].parts[1]).toEqual({ inlineData: { data: "x" } })
  })

  it("inserts a dedicated memory message when the first part has no text", () => {
    // gemini-pro-vision reshapes parts[0] into a raw string, so .text is undefined
    const messages = [{ role: "user", parts: ["raw vision string"] }]
    const result = buildAugmentedGoogleMessages(messages, memoryBlock)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: "user", parts: [{ text: memoryBlock }] })
    expect(result[1]).toBe(messages[0])
  })

  it("is idempotent — a second injection is a no-op", () => {
    const messages = [
      { role: "user", parts: [{ text: "ORIGINAL_SYSTEM" }] },
      { role: "user", parts: [{ text: "hi" }] }
    ]
    const once = buildAugmentedGoogleMessages(messages, memoryBlock)
    const twice = buildAugmentedGoogleMessages(once, memoryBlock)

    expect(twice).toBe(once)
    expect(twice[0].parts[0].text.split(MEMORY_TAG)).toHaveLength(2)
  })
})
