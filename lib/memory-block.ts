// Pure helpers for placing a memory block in a conversation. No server
// imports, so the browser can use them too: Ollama is called from the browser
// straight to localhost, and needs the block prepended client-side.

export const MEMORY_TAG = "[CHATMEMO_MEMORY]"

/**
 * Prepend a memory block to OpenAI-format messages ({ role, content }). The
 * block is prepended to the existing system message, or a new system message is
 * inserted when there is none. Idempotent: if the system message already
 * carries the memory tag (e.g. on a regeneration/retry) the input is returned
 * unchanged.
 */
export function buildAugmentedOpenAIMessages(
  messages: any[],
  memoryBlock: string
): any[] {
  const first = messages[0]

  if (first?.role === "system") {
    if (typeof first.content !== "string") return messages
    if (first.content.includes(MEMORY_TAG)) return messages
    return [
      { ...first, content: `${memoryBlock}${first.content}` },
      ...messages.slice(1)
    ]
  }

  return [{ role: "system", content: memoryBlock }, ...messages]
}
