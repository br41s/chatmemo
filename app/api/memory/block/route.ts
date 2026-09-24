import { HttpError } from "@/lib/server/http-error"
import { memoryBlockFor } from "@/lib/server/inject-memory"
import { readLimitedJson } from "@/lib/server/read-limited-json"
import { requireUser } from "@/lib/server/require-user"
import { z } from "zod"

// The memory block for a turn whose model the server never calls. Ollama runs
// in the browser against localhost, so the browser fetches the block here and
// prepends it itself; inference, and the conversation, stay on the machine.

const MAX_REQUEST_BYTES = 256 * 1024
const REQUEST_BODY_TIMEOUT_MS = 10_000

const tokens = z.number().int().positive().nullable().optional()

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

export async function POST(request: Request) {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response

    const parsed = requestSchema.safeParse(
      await readLimitedJson(request, {
        maxBytes: MAX_REQUEST_BYTES,
        timeoutMs: REQUEST_BODY_TIMEOUT_MS
      })
    )
    if (!parsed.success) {
      throw new HttpError("Memory request is invalid", 400)
    }

    const { lastUserText, contextBudget } = parsed.data
    // Never throws: a retrieval failure comes back as an empty block.
    const memory = await memoryBlockFor(
      auth.userId,
      lastUserText,
      contextBudget
    )

    return Response.json(memory)
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ message: error.message }, { status: error.status })
    }
    console.error("Memory block request failed", error)
    return Response.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    )
  }
}
