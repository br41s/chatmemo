import { generateLocalEmbeddings } from "@/lib/generate-local-embedding"
import { MAX_FILE_ITEM_CHUNKS } from "@/lib/retrieval/limits"
import {
  processCSV,
  processJSON,
  processMarkdown,
  processPdf,
  processTxt
} from "@/lib/retrieval/processing"
import {
  EmbeddingRequestError,
  generateOpenAIEmbeddings
} from "@/lib/server/openai-embeddings"
import {
  LimitedJsonError,
  readLimitedFormData
} from "@/lib/server/read-limited-json"
import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { Json } from "@/supabase/types"
import { FileItemChunk } from "@/types"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

const MAX_FORM_BYTES = 64 * 1024
const REQUEST_BODY_TIMEOUT_MS = 10_000
const DEFAULT_FILE_SIZE_LIMIT = 10_000_000
const MAX_CONFIGURABLE_FILE_SIZE_LIMIT = 50_000_000

const requestSchema = z
  .object({
    file_id: z.string().uuid(),
    embeddingsProvider: z.enum(["openai", "local"])
  })
  .strict()

class ProcessRouteError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ProcessRouteError"
    this.status = status
  }
}

function fileSizeLimit() {
  const configured = Number(process.env.NEXT_PUBLIC_USER_FILE_SIZE_LIMIT)
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    return DEFAULT_FILE_SIZE_LIMIT
  }
  return Math.min(configured, MAX_CONFIGURABLE_FILE_SIZE_LIMIT)
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

export async function POST(req: Request) {
  try {
    const profile = await getServerProfile()
    const supabase = createSessionClient(cookies())

    const formData = await readLimitedFormData(req, {
      maxBytes: MAX_FORM_BYTES,
      timeoutMs: REQUEST_BODY_TIMEOUT_MS
    })
    const parsed = requestSchema.safeParse({
      file_id: formData.get("file_id"),
      embeddingsProvider: formData.get("embeddingsProvider")
    })
    if (!parsed.success) {
      throw new ProcessRouteError("File processing request is invalid", 400)
    }
    const { file_id, embeddingsProvider } = parsed.data

    const { data: fileMetadata, error: metadataError } = await supabase
      .from("files")
      .select("id, user_id, file_path, name, size")
      .eq("id", file_id)
      .maybeSingle()

    if (metadataError) {
      throw new ProcessRouteError("File lookup failed", 500)
    }

    if (!fileMetadata || fileMetadata.user_id !== profile.user_id) {
      throw new ProcessRouteError("File is unavailable", 403)
    }
    const maxFileBytes = fileSizeLimit()
    if (fileMetadata.size > maxFileBytes) {
      throw new ProcessRouteError("File is too large to process", 413)
    }

    const pathSeparator = fileMetadata.file_path.lastIndexOf("/")
    const storageFolder = fileMetadata.file_path.slice(0, pathSeparator)
    const storageName = fileMetadata.file_path.slice(pathSeparator + 1)
    if (
      pathSeparator <= 0 ||
      fileMetadata.file_path.split("/", 1)[0] !== profile.user_id ||
      !storageName
    ) {
      throw new ProcessRouteError("File storage path is invalid", 403)
    }

    const fileStorage = supabase.storage.from("files")
    const { data: storedObjects, error: storageMetadataError } =
      await fileStorage.list(storageFolder, {
        limit: 100,
        search: storageName
      })
    const storedObject = storedObjects?.find(
      object => object.name === storageName
    )
    const storedSize = Number(storedObject?.metadata?.size)
    if (
      storageMetadataError ||
      !storedObject ||
      !Number.isSafeInteger(storedSize) ||
      storedSize < 0
    ) {
      throw new ProcessRouteError("File storage metadata is unavailable", 500)
    }
    if (storedSize > maxFileBytes) {
      throw new ProcessRouteError("File is too large to process", 413)
    }

    const { data: file, error: fileError } = await fileStorage.download(
      fileMetadata.file_path
    )

    if (fileError || !file) {
      throw new ProcessRouteError("File could not be downloaded", 500)
    }
    if (file.size > maxFileBytes) {
      throw new ProcessRouteError("File is too large to process", 413)
    }

    const fileExtension = fileMetadata.name.split(".").pop()?.toLowerCase()

    let chunks: FileItemChunk[] = []

    switch (fileExtension) {
      case "csv":
        chunks = await processCSV(file)
        break
      case "json":
        chunks = await processJSON(file)
        break
      case "md":
        chunks = await processMarkdown(file)
        break
      case "pdf":
        chunks = await processPdf(file)
        break
      case "txt":
        chunks = await processTxt(file)
        break
      default:
        throw new ProcessRouteError("Unsupported file type", 400)
    }

    if (chunks.length === 0 || chunks.length > MAX_FILE_ITEM_CHUNKS) {
      throw new ProcessRouteError("File produced an invalid chunk count", 400)
    }

    let embeddings: unknown[][]
    if (embeddingsProvider === "openai") {
      embeddings = await generateOpenAIEmbeddings(
        profile,
        chunks.map(chunk => chunk.content),
        req.signal
      )
    } else {
      embeddings = await generateLocalEmbeddings(
        chunks.map(chunk => chunk.content),
        req.signal
      )
    }

    const file_items = chunks.map((chunk, index) => ({
      file_id,
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
      p_file_id: file_id,
      p_items: file_items as Json,
      p_total_tokens: totalTokens
    })
    if (replaceError) {
      throw new ProcessRouteError("File items could not be saved", 500)
    }

    return new NextResponse("Embed Successful", {
      status: 200
    })
  } catch (error) {
    if (
      error instanceof ProcessRouteError ||
      error instanceof EmbeddingRequestError ||
      error instanceof LimitedJsonError
    ) {
      return errorResponse(error.message, error.status)
    }

    console.error("File processing failed", error)
    return errorResponse("An unexpected error occurred", 500)
  }
}
