import { generateLocalEmbeddings } from "@/lib/generate-local-embedding"
import { processDocX } from "@/lib/retrieval/processing"
import {
  MAX_DOCX_TEXT_CHARS,
  MAX_LOCAL_DOCX_TEXT_CHARS
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
import { Json } from "@/supabase/types"
import { FileItemChunk } from "@/types"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

const MAX_REQUEST_BYTES = 5 * 1024 * 1024
const REQUEST_BODY_TIMEOUT_MS = 10_000

const requestSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(MAX_DOCX_TEXT_CHARS)
      .refine(value => value.trim().length > 0),
    fileId: z.string().uuid(),
    embeddingsProvider: z.enum(["openai", "local"]),
    fileExtension: z.literal("docx")
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.embeddingsProvider === "local" &&
      value.text.length > MAX_LOCAL_DOCX_TEXT_CHARS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_LOCAL_DOCX_TEXT_CHARS,
        type: "string",
        inclusive: true,
        path: ["text"],
        message: "DOCX text is too large for local embeddings"
      })
    }
  })

class DocxRouteError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "DocxRouteError"
    this.status = status
  }
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

export async function POST(req: Request) {
  try {
    const supabase = createClient(cookies())
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      throw new DocxRouteError("Authentication required", 401)
    }

    const json = await readLimitedJson(req, {
      maxBytes: MAX_REQUEST_BYTES,
      timeoutMs: REQUEST_BODY_TIMEOUT_MS
    })
    const parsed = requestSchema.safeParse(json)
    if (!parsed.success) {
      throw new DocxRouteError("DOCX processing request is invalid", 400)
    }

    const { text, fileId, embeddingsProvider } = parsed.data

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, user_id")
      .eq("id", fileId)
      .maybeSingle()

    if (fileError) {
      throw new DocxRouteError("File lookup failed", 500)
    }

    if (!file || file.user_id !== user.id) {
      throw new DocxRouteError("File is unavailable", 403)
    }

    const profile = await getServerProfile()
    if (profile.user_id !== user.id) {
      throw new DocxRouteError("Authenticated profile is inconsistent", 403)
    }

    const chunks: FileItemChunk[] = await processDocX(text)

    let embeddings: any = []

    if (embeddingsProvider === "openai") {
      embeddings = await generateOpenAIEmbeddings(
        profile,
        chunks.map(chunk => chunk.content),
        req.signal
      )
    } else if (embeddingsProvider === "local") {
      embeddings = await generateLocalEmbeddings(
        chunks.map(chunk => chunk.content),
        req.signal
      )
    }

    const file_items = chunks.map((chunk, index) => ({
      file_id: fileId,
      user_id: profile.user_id,
      content: chunk.content,
      tokens: chunk.tokens,
      openai_embedding:
        embeddingsProvider === "openai"
          ? ((embeddings[index] || null) as any)
          : null,
      local_embedding:
        embeddingsProvider === "local"
          ? ((embeddings[index] || null) as any)
          : null
    }))

    const totalTokens = file_items.reduce((acc, item) => acc + item.tokens, 0)
    const { error: replaceError } = await supabase.rpc("replace_file_items", {
      p_file_id: fileId,
      p_items: file_items as Json,
      p_total_tokens: totalTokens
    })

    if (replaceError) {
      throw new DocxRouteError("File items could not be saved", 500)
    }

    return new NextResponse("Embed Successful", {
      status: 200
    })
  } catch (error) {
    if (
      error instanceof DocxRouteError ||
      error instanceof EmbeddingRequestError ||
      error instanceof LimitedJsonError
    ) {
      return errorResponse(error.message, error.status)
    }

    console.error("DOCX processing failed", error)
    return errorResponse("An unexpected error occurred", 500)
  }
}
