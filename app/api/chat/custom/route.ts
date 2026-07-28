import {
  createSafeModelTextStream,
  logSafeModelFailure,
  SafeModelRequestError
} from "@/lib/server/safe-model-stream"
import { textStreamResponse } from "@/lib/server/streaming"
import { createClient } from "@/lib/supabase/server"
import { ServerRuntime } from "next"
import { cookies } from "next/headers"
import { z } from "zod"

export const runtime: ServerRuntime = "nodejs"

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const REQUEST_BODY_TIMEOUT_MS = 15_000

const contentPartSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string().max(100_000)
    })
    .strict(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z
        .object({
          url: z
            .string()
            .max(MAX_REQUEST_BYTES)
            .regex(/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/]*={0,2}$/)
        })
        .strict()
    })
    .strict()
])

const messagesSchema = z
  .array(
    z
      .object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.union([
          z.string().max(100_000),
          z.array(contentPartSchema).min(1).max(20)
        ])
      })
      .strict()
  )
  .min(1)
  .max(200)

const currentRequestSchema = z
  .object({
    customModelId: z.string().uuid(),
    temperature: z.number().finite().min(0).max(2),
    messages: messagesSchema
  })
  .strict()

const legacyRequestSchema = z
  .object({
    customModelId: z.string().uuid(),
    chatSettings: z
      .object({
        model: z.string(),
        prompt: z.string(),
        temperature: z.number().finite().min(0).max(2),
        contextLength: z.number().finite(),
        includeProfileContext: z.boolean(),
        includeWorkspaceInstructions: z.boolean(),
        embeddingsProvider: z.enum(["openai", "local"])
      })
      .strict(),
    messages: messagesSchema
  })
  .strict()

const requestSchema = z.union([currentRequestSchema, legacyRequestSchema])

class CustomModelRouteError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "CustomModelRouteError"
    this.status = status
  }
}

async function readLimitedJson(request: Request) {
  const rawContentLength = request.headers.get("content-length")
  if (rawContentLength) {
    const contentLength = Number(rawContentLength)
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_REQUEST_BYTES
    ) {
      throw new CustomModelRouteError("Request body is too large", 413)
    }
  }

  if (!request.body) {
    throw new CustomModelRouteError("Request body is required", 400)
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const deadline = Date.now() + REQUEST_BODY_TIMEOUT_MS

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      await reader.cancel()
      throw new CustomModelRouteError("Request body timed out", 408)
    }
    const { done, value } = await new Promise<
      ReadableStreamReadResult<Uint8Array>
    >((resolve, reject) => {
      const timeout = setTimeout(() => {
        void reader.cancel()
        reject(new CustomModelRouteError("Request body timed out", 408))
      }, remaining)
      reader.read().then(
        result => {
          clearTimeout(timeout)
          resolve(result)
        },
        error => {
          clearTimeout(timeout)
          reject(error)
        }
      )
    })
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel()
      throw new CustomModelRouteError("Request body is too large", 413)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    return JSON.parse(text) as unknown
  } catch {
    throw new CustomModelRouteError("Request body must be valid JSON", 400)
  }
}

function errorResponse(message: string, status: number, correlationId: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": correlationId
    }
  })
}

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID()

  try {
    const json = await readLimitedJson(request)
    const parsed = requestSchema.safeParse(json)
    if (!parsed.success) {
      throw new CustomModelRouteError("Custom model request is invalid", 400)
    }

    const { customModelId, messages } = parsed.data
    const temperature =
      "temperature" in parsed.data
        ? parsed.data.temperature
        : parsed.data.chatSettings.temperature
    const supabase = createClient(cookies())
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      throw new CustomModelRouteError("Authentication required", 401)
    }

    const { data: customModel, error: modelError } = await supabase
      .from("models")
      .select("id, user_id, api_key, base_url, model_id")
      .eq("id", customModelId)
      .maybeSingle()

    if (modelError) {
      throw new CustomModelRouteError("Custom model lookup failed", 500)
    }

    if (
      !customModel ||
      (customModel.user_id !== user.id && customModel.api_key !== "")
    ) {
      throw new CustomModelRouteError("Custom model is unavailable", 403)
    }

    const stream = await createSafeModelTextStream({
      apiKey: customModel.api_key,
      baseUrl: customModel.base_url,
      correlationId,
      messages,
      model: customModel.model_id,
      signal: request.signal,
      temperature
    })

    const response = textStreamResponse(stream)
    response.headers.set("X-Request-ID", correlationId)
    return response
  } catch (error) {
    if (error instanceof CustomModelRouteError) {
      return errorResponse(error.message, error.status, correlationId)
    }

    logSafeModelFailure(correlationId, error)
    if (error instanceof SafeModelRequestError) {
      return errorResponse(error.message, error.status, correlationId)
    }

    return errorResponse("An unexpected error occurred", 500, correlationId)
  }
}
