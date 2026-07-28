import { generateLocalEmbedding } from "@/lib/generate-local-embedding"
import {
  MAX_RETRIEVAL_FILE_IDS,
  MAX_RETRIEVAL_QUERY_CHARS,
  MAX_RETRIEVAL_SOURCE_COUNT
} from "@/lib/retrieval/limits"
import {
  LimitedJsonError,
  readLimitedJson
} from "@/lib/server/read-limited-json"
import {
  EmbeddingRequestError,
  generateOpenAIEmbeddings
} from "@/lib/server/openai-embeddings"
import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { z } from "zod"

const MAX_REQUEST_BYTES = 256 * 1024
const REQUEST_BODY_TIMEOUT_MS = 10_000

const requestSchema = z
  .object({
    userInput: z.string().min(1).max(MAX_RETRIEVAL_QUERY_CHARS),
    fileIds: z.array(z.string().uuid()).min(1).max(MAX_RETRIEVAL_FILE_IDS),
    embeddingsProvider: z.enum(["openai", "local"]),
    sourceCount: z.number().int().min(1).max(MAX_RETRIEVAL_SOURCE_COUNT)
  })
  .strict()

class RetrievalRouteError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "RetrievalRouteError"
    this.status = status
  }
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

export async function POST(request: Request) {
  try {
    const json = await readLimitedJson(request, {
      maxBytes: MAX_REQUEST_BYTES,
      timeoutMs: REQUEST_BODY_TIMEOUT_MS
    })
    const parsed = requestSchema.safeParse(json)
    if (!parsed.success) {
      throw new RetrievalRouteError("Retrieval request is invalid", 400)
    }

    const { userInput, fileIds, embeddingsProvider, sourceCount } = parsed.data
    const uniqueFileIds = [...new Set(fileIds)]
    const supabase = createClient(cookies())
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      throw new RetrievalRouteError("Authentication required", 401)
    }

    const { data: visibleFiles, error: filesError } = await supabase
      .from("files")
      .select("id")
      .in("id", uniqueFileIds)

    if (filesError) {
      throw new RetrievalRouteError("File lookup failed", 500)
    }

    const visibleIds = new Set((visibleFiles || []).map(file => file.id))
    if (
      visibleIds.size !== uniqueFileIds.length ||
      uniqueFileIds.some(fileId => !visibleIds.has(fileId))
    ) {
      throw new RetrievalRouteError("One or more files are unavailable", 403)
    }

    const profile = await getServerProfile()

    let chunks: Array<{ similarity: number }> = []

    if (embeddingsProvider === "openai") {
      const [openaiEmbedding] = await generateOpenAIEmbeddings(
        profile,
        userInput,
        request.signal
      )

      const { data: openaiFileItems, error: openaiError } = await supabase.rpc(
        "match_file_items_openai",
        {
          query_embedding: openaiEmbedding as any,
          match_count: sourceCount,
          file_ids: uniqueFileIds
        }
      )

      if (openaiError) {
        throw openaiError
      }

      chunks = openaiFileItems || []
    } else if (embeddingsProvider === "local") {
      const localEmbedding = await generateLocalEmbedding(
        userInput,
        request.signal
      )

      const { data: localFileItems, error: localFileItemsError } =
        await supabase.rpc("match_file_items_local", {
          query_embedding: localEmbedding as any,
          match_count: sourceCount,
          file_ids: uniqueFileIds
        })

      if (localFileItemsError) {
        throw localFileItemsError
      }

      chunks = localFileItems || []
    }

    const mostSimilarChunks = chunks?.sort(
      (a, b) => b.similarity - a.similarity
    )

    return new Response(JSON.stringify({ results: mostSimilarChunks }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  } catch (error) {
    if (
      error instanceof EmbeddingRequestError ||
      error instanceof LimitedJsonError ||
      error instanceof RetrievalRouteError
    ) {
      return errorResponse(error.message, error.status)
    }

    console.error("Retrieval failed", error)
    return errorResponse("An unexpected error occurred", 500)
  }
}
