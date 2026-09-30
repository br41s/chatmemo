import { HttpError } from "@/lib/server/http-error"
import { readLimitedJson } from "@/lib/server/read-limited-json"
import { z } from "zod"

// What the browser sends when it asks about memory for a turn: the text the
// retrieval layers will search by, and the hint the budget is resolved from.
// Shared by the routes that answer such a request so they cannot drift apart
// on what they accept.

const MAX_REQUEST_BYTES = 256 * 1024
const REQUEST_BODY_TIMEOUT_MS = 10_000

// Zero is accepted, as the chat routes accept it: the context-length slider
// goes down to 0, the budget falls back to its default for it, and refusing
// it here meant a turn that worked got no memory block and no preview.
const tokens = z.number().int().nonnegative().nullable().optional()

const requestSchema = z
  .object({
    lastUserText: z.string().max(100_000),
    contextBudget: z
      .object({
        windowTokens: tokens,
        requestedHistoryTokens: tokens,
        outputTokens: tokens
      })
      .strict()
      .optional()
  })
  .strict()

type MemoryRequest = z.infer<typeof requestSchema>

/** The parsed request, or an `HttpError` the route answers with. */
export async function readMemoryRequest(
  request: Request
): Promise<MemoryRequest> {
  const parsed = requestSchema.safeParse(
    await readLimitedJson(request, {
      maxBytes: MAX_REQUEST_BYTES,
      timeoutMs: REQUEST_BODY_TIMEOUT_MS
    })
  )
  if (!parsed.success) {
    throw new HttpError("Memory request is invalid", 400)
  }
  return parsed.data
}
