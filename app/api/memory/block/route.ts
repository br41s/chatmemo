import { HttpError } from "@/lib/server/http-error"
import { memoryBlockFor } from "@/lib/server/inject-memory"
import { readMemoryRequest } from "@/lib/server/memory-request"
import { requireUser } from "@/lib/server/require-user"

// The memory block for a turn whose model the server never calls. Ollama runs
// in the browser against localhost, so the browser fetches the block here and
// prepends it itself; inference, and the conversation, stay on the machine.

export async function POST(request: Request) {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response

    const { lastUserText, contextBudget } = await readMemoryRequest(request)
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
