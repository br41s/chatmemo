import { HttpError } from "@/lib/server/http-error"
import { recallPreviewFor } from "@/lib/server/inject-memory"
import { readMemoryRequest } from "@/lib/server/memory-request"
import { requireUser } from "@/lib/server/require-user"

// Which stored conversations a turn is about to be reminded of.
//
// The memory report rides on the chat response's headers, and those only leave
// the server once the model has begun to answer — so for the whole wait the
// browser knew nothing it could show. It asks here instead, alongside the chat
// request: the same relevance search, a second or two ahead of the answer.
// Titles and sources only; the text itself never leaves the server this way.

export async function POST(request: Request) {
  try {
    const auth = await requireUser()
    if ("response" in auth) return auth.response

    const { lastUserText, contextBudget } = await readMemoryRequest(request)
    // Never throws: a retrieval failure comes back as nothing to show.
    const preview = await recallPreviewFor(
      auth.userId,
      lastUserText,
      contextBudget
    )

    return Response.json(preview)
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ message: error.message }, { status: error.status })
    }
    console.error("Memory recall request failed", error)
    return Response.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    )
  }
}
