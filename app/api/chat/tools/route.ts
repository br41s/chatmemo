import { openapiToFunctions } from "@/lib/openapi-conversion"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { isShareableToolConfig } from "@/lib/tool-sharing"
import { ChatSettings } from "@/types"
import { openAIStreamResponse } from "@/lib/server/streaming"
import {
  assertSafeToolUrl,
  buildSafeToolUrl,
  safeToolRequest,
  sanitizeToolHeaders,
  UnsafeToolRequestError
} from "@/lib/server/safe-tool-request"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import OpenAI from "openai"
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions.mjs"

const MAX_SELECTED_TOOLS = 20
const MAX_TOOL_CALLS = 10
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const REQUEST_BODY_TIMEOUT_MS = 15_000
const TOOL_EXECUTION_TIMEOUT_MS = 30_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ToolOperationDetail {
  url: string
  headers: Record<string, string>
  method: "GET" | "POST"
  pathTemplate: string
  requestInBody: boolean
}

function validateSelectedToolIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_SELECTED_TOOLS ||
    value.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))
  ) {
    throw new UnsafeToolRequestError("Selected tool IDs are invalid")
  }

  return [...new Set(value)] as string[]
}

function encodePathParameter(value: unknown) {
  const text = String(value)
  if (
    text === "." ||
    text === ".." ||
    text.includes("/") ||
    text.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(text)
  ) {
    throw new UnsafeToolRequestError("Tool path parameter is invalid")
  }

  return encodeURIComponent(text)
}

async function readLimitedJson(request: Request) {
  const contentLength = request.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new UnsafeToolRequestError("Request body is too large", 413)
  }

  if (!request.body) {
    throw new UnsafeToolRequestError("Request body is required")
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  const deadline = Date.now() + REQUEST_BODY_TIMEOUT_MS

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      await reader.cancel()
      throw new UnsafeToolRequestError("Request body timed out", 408)
    }
    const { done, value } = await new Promise<
      ReadableStreamReadResult<Uint8Array>
    >((resolve, reject) => {
      const timeout = setTimeout(() => {
        void reader.cancel()
        reject(new UnsafeToolRequestError("Request body timed out", 408))
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

    receivedBytes += value.byteLength
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel()
      throw new UnsafeToolRequestError("Request body is too large", 413)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(receivedBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new UnsafeToolRequestError("Request body must be valid JSON")
  }
}

export async function POST(request: Request) {
  try {
    const json = await readLimitedJson(request)
    const {
      chatSettings,
      messages,
      selectedToolIds,
      selectedTools: legacySelectedTools
    } = json as {
      chatSettings: ChatSettings
      messages: any[]
      selectedToolIds: unknown
      selectedTools?: Array<{ id?: unknown }>
    }
    const requestedToolIds =
      selectedToolIds ??
      legacySelectedTools?.map(selectedTool => selectedTool?.id)
    const toolIds = validateSelectedToolIds(requestedToolIds)
    const profile = await getServerProfile()
    const supabase = createClient(cookies())

    const { data: storedTools, error: toolsError } = await supabase
      .from("tools")
      .select("id, user_id, schema, url, custom_headers")
      .in("id", toolIds)

    if (toolsError) {
      throw toolsError
    }

    if (!storedTools || storedTools.length !== toolIds.length) {
      throw new UnsafeToolRequestError(
        "One or more selected tools are unavailable",
        403
      )
    }

    const storedToolsById = new Map(storedTools.map(tool => [tool.id, tool]))
    const selectedTools = toolIds.map(toolId => {
      const tool = storedToolsById.get(toolId)!
      const headers = sanitizeToolHeaders(tool.custom_headers)

      if (tool.user_id !== profile.user_id && Object.keys(headers).length > 0) {
        throw new UnsafeToolRequestError(
          "Shared tools cannot expose custom headers",
          403
        )
      }

      if (
        tool.user_id !== profile.user_id &&
        !isShareableToolConfig(tool.schema, tool.url)
      ) {
        throw new UnsafeToolRequestError(
          "Shared tools cannot expose embedded credentials",
          403
        )
      }

      return { ...tool, headers }
    })

    // Route to OpenRouter when model uses provider/name format (e.g. openai/gpt-4o),
    // otherwise fall back to direct OpenAI.
    const isOpenRouterModel = chatSettings.model.includes("/")

    let openai: OpenAI
    if (isOpenRouterModel) {
      checkApiKey(profile.openrouter_api_key, "OpenRouter")
      openai = new OpenAI({
        apiKey: profile.openrouter_api_key || "",
        baseURL: "https://openrouter.ai/api/v1"
      })
    } else {
      checkApiKey(profile.openai_api_key, "OpenAI")
      openai = new OpenAI({
        apiKey: profile.openai_api_key || "",
        organization: profile.openai_organization_id
      })
    }

    let allTools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
    const operations = new Map<string, ToolOperationDetail>()

    for (const selectedTool of selectedTools) {
      try {
        const storedSchema =
          typeof selectedTool.schema === "string"
            ? JSON.parse(selectedTool.schema)
            : selectedTool.schema
        const convertedSchema = await openapiToFunctions(storedSchema)
        const tools = convertedSchema.functions || []
        allTools = allTools.concat(tools)

        assertSafeToolUrl(convertedSchema.info.server)
        for (const route of convertedSchema.routes) {
          const method = route.method.toUpperCase()
          if (method !== "GET" && method !== "POST") {
            throw new UnsafeToolRequestError(
              `Tool operation ${route.operationId} uses an unsupported method`
            )
          }
          if (method === "GET" && route.requestInBody) {
            throw new UnsafeToolRequestError(
              `Tool operation ${route.operationId} cannot use a GET request body`
            )
          }
          if (operations.has(route.operationId)) {
            throw new UnsafeToolRequestError(
              `Tool operation ${route.operationId} is duplicated`
            )
          }

          operations.set(route.operationId, {
            url: convertedSchema.info.server,
            headers: selectedTool.headers,
            method,
            pathTemplate: route.path.replace(/{(\w+)}/g, ":$1"),
            requestInBody: Boolean(route.requestInBody)
          })
        }
      } catch (error: any) {
        if (error instanceof UnsafeToolRequestError) {
          throw error
        }

        console.error("Error converting schema", error)
        throw new UnsafeToolRequestError("Selected tool schema is invalid")
      }
    }

    const firstResponse = await openai.chat.completions.create(
      {
        model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
        messages,
        tools: allTools.length > 0 ? allTools : undefined
      },
      { signal: request.signal }
    )

    const message = firstResponse.choices[0].message
    messages.push(message)
    const toolCalls = message.tool_calls || []

    if (toolCalls.length > MAX_TOOL_CALLS) {
      throw new UnsafeToolRequestError(
        "The model requested too many tool calls",
        502
      )
    }

    if (toolCalls.length === 0) {
      return new Response(message.content, {
        headers: {
          "Content-Type": "application/json"
        }
      })
    }

    if (toolCalls.length > 0) {
      const toolExecutionDeadline = Date.now() + TOOL_EXECUTION_TIMEOUT_MS

      const remainingToolExecutionTime = () => {
        const remaining = toolExecutionDeadline - Date.now()
        if (remaining <= 0) {
          throw new UnsafeToolRequestError("Tool execution timed out", 504)
        }

        return remaining
      }

      for (const toolCall of toolCalls) {
        const functionCall = toolCall.function
        const functionName = functionCall.name
        const argumentsString = toolCall.function.arguments.trim()
        const parsedArgs = JSON.parse(argumentsString)

        const operation = operations.get(functionName)
        if (!operation) {
          throw new Error(`Function ${functionName} not found in any schema`)
        }

        const path = operation.pathTemplate.replace(
          /:(\w+)/g,
          (_, paramName) => {
            const value = parsedArgs.parameters?.[paramName]
            if (value === undefined || value === null) {
              throw new Error(
                `Parameter ${paramName} not found for function ${functionName}`
              )
            }
            return encodePathParameter(value)
          }
        )

        if (!path) {
          throw new Error(`Path for function ${functionName} not found`)
        }

        const queryParams = new URLSearchParams()
        for (const [name, value] of Object.entries(
          parsedArgs.parameters || {}
        )) {
          if (value !== undefined && value !== null) {
            queryParams.append(name, String(value))
          }
        }

        const fullUrl = buildSafeToolUrl(operation.url, path, queryParams)
        const headers = operation.requestInBody
          ? { ...operation.headers, "Content-Type": "application/json" }
          : operation.headers
        const body = operation.requestInBody
          ? JSON.stringify(parsedArgs.requestBody ?? {})
          : undefined

        const data = await safeToolRequest(fullUrl, {
          method: operation.method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: request.signal,
          timeoutMs: remainingToolExecutionTime()
        })

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: JSON.stringify(data)
        })
      }
    }

    const secondResponse = await openai.chat.completions.create(
      {
        model: chatSettings.model as ChatCompletionCreateParamsBase["model"],
        messages,
        stream: true
      },
      { signal: request.signal }
    )

    return openAIStreamResponse(secondResponse)
  } catch (error: any) {
    console.error(error)
    const isExpectedRequestError = error instanceof UnsafeToolRequestError
    const errorMessage = isExpectedRequestError
      ? error.message
      : error.error?.message || "An unexpected error occurred"
    const errorCode = isExpectedRequestError
      ? error.status
      : error.status || 500
    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
