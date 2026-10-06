// Pure helpers for placing a memory block in a conversation. No server
// imports, so the browser can use them too: Ollama is called from the browser
// straight to localhost, and needs the block prepended client-side.

export const MEMORY_TAG = "[CHATMEMO_MEMORY]"

// The text the memory layers search by: what the turn's last user message
// says, read from the messages exactly as they are sent. One definition, used
// by the server's injectors and by the browser when it asks for a preview of
// the same turn. The browser used to pass the text typed into the composer
// instead, which is not always what arrives: on Regenerate it was the previous
// answer, a message too long for the history budget is dropped before sending,
// and one carrying images or retrieved file text arrives as something else.

/** From OpenAI-format messages ({ role, content }). Only a plain string
 *  counts: a message made of content parts is not searched by. */
export function lastUserTextOpenAI(messages: any[]): string {
  const lastUser = [...messages].reverse().find(m => m?.role === "user")
  return typeof lastUser?.content === "string" ? lastUser.content : ""
}

/** From Google Gemini-format messages ({ role, parts: [{ text }] }). */
export function lastUserTextGoogle(messages: any[]): string {
  const last = messages[messages.length - 1]
  return Array.isArray(last?.parts)
    ? last.parts.map((p: any) => p?.text ?? "").join(" ")
    : ""
}

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

// Stored memory is untrusted text: imports, bookmarklet posts, sessions that
// read a hostile page. A row that contains one of the block's own tags could
// close a section early and put "rules" of its own after it. The tags are
// known, so a row's copy of any of them is marked as a quotation before it is
// placed: `[/LESSONS]` becomes `⟦/LESSONS⟧`, same length, and the report's
// section parser (lib/memory-report.ts) no longer mistakes it for the end.
//
// Matched loosely — any case, spaces around the slash and inside the name —
// because the model would read `[/lessons]` or `[ /LESSONS]` as a closing tag
// just the same. This is what keeps the block's structure and the report's
// parser honest; the model-side defence is rule 9 of the instructions, which
// says the sections are data. A row can still forge a `### [date]` header or
// a `---` separator inside a section: those are not tags, and the rule is
// what covers them.
const MEMORY_TAG_RE =
  /\[(\s*\/?\s*)(CHATMEMO_MEMORY|LESSONS|CONVERSATION\s+HISTORY|RELEVANT\s+MEMORY|FULL\s+CONVERSATION\s+RETRIEVAL|MEMORY\s+CONTENT)\b([^\]\n]*)\]/gi

/** `text` with any of the memory block's own tags turned into quotations. */
export function neutraliseMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG_RE, "⟦$1$2$3⟧")
}
