import { lookup as dnsLookup } from "node:dns/promises"
import { IncomingMessage } from "node:http"
import { request as httpsRequest, RequestOptions } from "node:https"
import { isIP } from "node:net"
import {
  assertSafeToolUrl,
  isBlockedToolAddress,
  LookupAddress,
  UnsafeToolRequestError
} from "./safe-tool-request"

const CONNECT_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 30_000
const TOTAL_TIMEOUT_MS = 5 * 60_000
const MAX_HEADER_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_EVENT_BYTES = 1024 * 1024

export type SafeModelPhase =
  | "validation"
  | "dns"
  | "connect"
  | "upstream"
  | "stream"
  | "abort"

export class SafeModelRequestError extends Error {
  status: number
  phase: SafeModelPhase
  code: string

  constructor(
    message: string,
    status: number,
    phase: SafeModelPhase,
    code: string
  ) {
    super(message)
    this.name = "SafeModelRequestError"
    this.status = status
    this.phase = phase
    this.code = code
  }
}

export interface SafeModelMessage {
  role: "system" | "user" | "assistant"
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >
}

export interface SafeModelStreamRequest {
  apiKey: string
  baseUrl: string
  correlationId: string
  messages: SafeModelMessage[]
  model: string
  signal?: AbortSignal
  temperature: number
}

type AddressLookup = (hostname: string) => Promise<LookupAddress[]>

interface OpenResponse {
  response: IncomingMessage
  dispose: () => void
}

type ModelTransport = (
  url: URL,
  body: string,
  apiKey: string,
  address: LookupAddress,
  signal: AbortSignal | undefined
) => Promise<OpenResponse>

interface SafeModelStreamDependencies {
  lookup?: AddressLookup
  transport?: ModelTransport
}

function fail(
  message: string,
  status: number,
  phase: SafeModelPhase,
  code: string
): never {
  throw new SafeModelRequestError(message, status, phase, code)
}

function normalizedHostname(url: URL) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname
}

export function buildSafeModelCompletionUrl(rawBaseUrl: string) {
  if (
    typeof rawBaseUrl !== "string" ||
    /[\\\u0000-\u001f\u007f]/.test(rawBaseUrl)
  ) {
    fail("Custom model URL is invalid", 400, "validation", "invalid_url")
  }

  let baseUrl: URL
  try {
    baseUrl = assertSafeToolUrl(rawBaseUrl)
  } catch (error) {
    if (error instanceof UnsafeToolRequestError) {
      fail(error.message, error.status, "validation", "unsafe_url")
    }
    throw error
  }

  if (baseUrl.search || baseUrl.hash) {
    fail(
      "Custom model base URL cannot contain a query or fragment",
      400,
      "validation",
      "invalid_base_url"
    )
  }

  if (normalizedHostname(baseUrl).endsWith(".")) {
    fail(
      "Custom model hostname cannot end with a dot",
      400,
      "validation",
      "invalid_hostname"
    )
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, "")
  const completionUrl = new URL(`${baseUrl.origin}${basePath}/chat/completions`)

  if (completionUrl.origin !== baseUrl.origin) {
    fail(
      "Custom model URL changed origin unexpectedly",
      400,
      "validation",
      "origin_changed"
    )
  }

  return completionUrl
}

const defaultLookup: AddressLookup = hostname =>
  dnsLookup(hostname, { all: true, verbatim: true })

export async function resolveSafeModelAddresses(
  url: URL,
  lookup: AddressLookup = defaultLookup
) {
  const hostname = normalizedHostname(url)
  const literalFamily = isIP(hostname)
  let addresses: LookupAddress[]

  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookup(hostname)
  } catch {
    fail(
      "Custom model hostname could not be resolved",
      400,
      "dns",
      "dns_failed"
    )
  }

  if (addresses.length === 0) {
    fail("Custom model hostname did not resolve", 400, "dns", "dns_empty")
  }

  if (
    addresses.some(({ address, family }) =>
      isBlockedToolAddress(address, family)
    )
  ) {
    fail(
      "Custom model hostname resolves to a non-public address",
      400,
      "dns",
      "dns_non_public"
    )
  }

  return addresses
}

function guardModelLookup<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(
      new SafeModelRequestError(
        "Custom model request was cancelled",
        499,
        "abort",
        "aborted"
      )
    )
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () =>
      rejectOnce(
        new SafeModelRequestError(
          "Custom model request was cancelled",
          499,
          "abort",
          "aborted"
        )
      )

    timeout = setTimeout(
      () =>
        rejectOnce(
          new SafeModelRequestError(
            "Custom model hostname lookup timed out",
            504,
            "dns",
            "dns_timeout"
          )
        ),
      CONNECT_TIMEOUT_MS
    )
    signal?.addEventListener("abort", abort, { once: true })
    promise.then(value => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, rejectOnce)
  })
}

function defaultTransport(
  url: URL,
  body: string,
  apiKey: string,
  address: LookupAddress,
  signal: AbortSignal | undefined
) {
  return new Promise<OpenResponse>((resolve, reject) => {
    let settled = false
    let activeResponse: IncomingMessage | undefined
    let totalTimer: ReturnType<typeof setTimeout> | undefined
    const request = httpsRequest(
      buildPinnedModelRequestOptions(url, body, apiKey, address),
      response => {
        settled = true
        activeResponse = response
        clearTimeout(connectTimer)

        response.setTimeout(IDLE_TIMEOUT_MS, () => {
          response.destroy(
            new SafeModelRequestError(
              "Custom model stream became idle",
              504,
              "stream",
              "idle_timeout"
            )
          )
        })

        totalTimer = setTimeout(() => {
          response.destroy(
            new SafeModelRequestError(
              "Custom model request timed out",
              504,
              "stream",
              "total_timeout"
            )
          )
        }, TOTAL_TIMEOUT_MS)

        const dispose = () => {
          if (totalTimer) clearTimeout(totalTimer)
          signal?.removeEventListener("abort", abortRequest)
          if (!response.destroyed) response.destroy()
        }

        resolve({ response, dispose })
      }
    )

    const connectTimer = setTimeout(() => {
      request.destroy(
        new SafeModelRequestError(
          "Custom model connection timed out",
          504,
          "connect",
          "connect_timeout"
        )
      )
    }, CONNECT_TIMEOUT_MS)

    const abortRequest = () => {
      const abortError = new SafeModelRequestError(
        "Custom model request was cancelled",
        499,
        "abort",
        "aborted"
      )
      activeResponse?.destroy(abortError)
      request.destroy(abortError)
    }

    signal?.addEventListener("abort", abortRequest, { once: true })

    request.on("error", error => {
      clearTimeout(connectTimer)
      if (totalTimer) clearTimeout(totalTimer)
      signal?.removeEventListener("abort", abortRequest)

      if (settled) return
      reject(
        error instanceof SafeModelRequestError
          ? error
          : new SafeModelRequestError(
              "Custom model connection failed",
              502,
              "connect",
              "connection_failed"
            )
      )
    })

    if (signal?.aborted) {
      abortRequest()
      return
    }

    request.end(body)
  })
}

export function buildSafeModelHeaders(body: string, apiKey: string) {
  if (apiKey.length > 1000 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    fail(
      "Custom model API key is invalid",
      400,
      "validation",
      "invalid_api_key"
    )
  }

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Accept-Encoding": "identity",
    "Content-Length": Buffer.byteLength(body).toString(),
    "Content-Type": "application/json"
  }

  if (apiKey !== "") {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
}

export function buildPinnedModelRequestOptions(
  url: URL,
  body: string,
  apiKey: string,
  address: LookupAddress
): RequestOptions {
  const hostname = normalizedHostname(url)

  return {
    agent: false,
    headers: buildSafeModelHeaders(body, apiKey),
    hostname,
    lookup: ((_requestedHostname: string, options: any, callback: any) => {
      if (options?.all) {
        callback(null, [address])
        return
      }
      callback(null, address.address, address.family)
    }) as any,
    maxHeaderSize: MAX_HEADER_BYTES,
    method: "POST",
    path: `${url.pathname}${url.search}`,
    port: url.port || 443,
    protocol: "https:",
    servername: isIP(hostname) ? undefined : hostname
  }
}

function validateUpstreamResponse(response: IncomingMessage) {
  const status = response.statusCode || 0
  if (status < 200 || status >= 300) {
    response.destroy()
    fail(
      "Custom model provider returned an error",
      502,
      "upstream",
      "upstream_status"
    )
  }

  const contentType = response.headers["content-type"] || ""
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    response.destroy()
    fail(
      "Custom model provider did not return an event stream",
      502,
      "upstream",
      "invalid_content_type"
    )
  }

  const contentEncoding = response.headers["content-encoding"]
  if (
    contentEncoding &&
    contentEncoding.toString().trim().toLowerCase() !== "identity"
  ) {
    response.destroy()
    fail(
      "Compressed custom model responses are not supported",
      502,
      "upstream",
      "compressed_response"
    )
  }
}

function parseEvent(dataLines: string[]) {
  if (dataLines.length === 0) return { done: false, text: "" }

  const data = dataLines.join("\n")
  if (Buffer.byteLength(data) > MAX_EVENT_BYTES) {
    fail(
      "Custom model event exceeded the size limit",
      502,
      "stream",
      "event_too_large"
    )
  }

  if (data.trim() === "[DONE]") return { done: true, text: "" }

  let event: unknown
  try {
    event = JSON.parse(data)
  } catch {
    fail(
      "Custom model returned invalid event data",
      502,
      "stream",
      "invalid_event_json"
    )
  }

  if (
    typeof event === "object" &&
    event !== null &&
    "error" in event &&
    (event as { error?: unknown }).error
  ) {
    fail(
      "Custom model provider returned a stream error",
      502,
      "stream",
      "upstream_stream_error"
    )
  }

  const content = (event as any)?.choices?.[0]?.delta?.content
  if (content === null || content === undefined) {
    return { done: false, text: "" }
  }

  if (typeof content !== "string") {
    fail(
      "Custom model returned invalid event content",
      502,
      "stream",
      "invalid_event_content"
    )
  }

  return { done: false, text: content }
}

async function* readTextEvents(
  response: IncomingMessage,
  dispose: () => void,
  correlationId: string,
  signal: AbortSignal | undefined
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffered = ""
  let dataLines: string[] = []
  let eventBytes = 0
  let responseBytes = 0

  const handleLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (line === "") {
      const parsed = parseEvent(dataLines)
      dataLines = []
      eventBytes = 0
      return parsed
    }

    if (line.startsWith("data:")) {
      const value = line.slice(5)
      const data = value.startsWith(" ") ? value.slice(1) : value
      eventBytes += Buffer.byteLength(data) + (dataLines.length > 0 ? 1 : 0)
      if (eventBytes > MAX_EVENT_BYTES) {
        fail(
          "Custom model event exceeded the size limit",
          502,
          "stream",
          "event_too_large"
        )
      }
      dataLines.push(data)
    }

    return null
  }

  try {
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      responseBytes += bytes.byteLength
      if (responseBytes > MAX_RESPONSE_BYTES) {
        fail(
          "Custom model response exceeded the size limit",
          502,
          "stream",
          "response_too_large"
        )
      }

      buffered += decoder.decode(bytes, { stream: true })
      let lineEnd = buffered.indexOf("\n")
      while (lineEnd >= 0) {
        const parsed = handleLine(buffered.slice(0, lineEnd))
        buffered = buffered.slice(lineEnd + 1)

        if (parsed?.text) yield parsed.text
        if (parsed?.done) return
        lineEnd = buffered.indexOf("\n")
      }
      if (Buffer.byteLength(buffered) > MAX_EVENT_BYTES) {
        fail(
          "Custom model event line exceeded the size limit",
          502,
          "stream",
          "event_too_large"
        )
      }
    }

    buffered += decoder.decode()
    if (buffered !== "") {
      const parsed = handleLine(buffered)
      if (parsed?.text) yield parsed.text
      if (parsed?.done) return
    }

    const finalEvent = parseEvent(dataLines)
    if (finalEvent.text) yield finalEvent.text
    if (!finalEvent.done) {
      fail(
        "Custom model stream ended before completion",
        502,
        "stream",
        "stream_truncated"
      )
    }
  } catch (error) {
    const streamError =
      error instanceof SafeModelRequestError
        ? error
        : signal?.aborted
          ? new SafeModelRequestError(
              "Custom model request was cancelled",
              499,
              "abort",
              "aborted"
            )
          : new SafeModelRequestError(
              "Custom model stream failed",
              502,
              "stream",
              "stream_failed"
            )
    logSafeModelFailure(correlationId, streamError)
    throw streamError
  } finally {
    dispose()
  }
}

export async function createSafeModelTextStream(
  input: SafeModelStreamRequest,
  dependencies: SafeModelStreamDependencies = {}
) {
  if (
    typeof input.model !== "string" ||
    input.model.length === 0 ||
    input.model.length > 1000 ||
    /[\u0000-\u001f\u007f]/.test(input.model)
  ) {
    fail("Custom model ID is invalid", 400, "validation", "invalid_model_id")
  }

  const url = buildSafeModelCompletionUrl(input.baseUrl)
  const addresses = await guardModelLookup(
    resolveSafeModelAddresses(url, dependencies.lookup),
    input.signal
  )
  const body = JSON.stringify({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    stream: true
  })
  const transport = dependencies.transport || defaultTransport
  const opened = await transport(
    url,
    body,
    input.apiKey,
    addresses[0],
    input.signal
  )

  try {
    validateUpstreamResponse(opened.response)
  } catch (error) {
    opened.dispose()
    throw error
  }

  return readTextEvents(
    opened.response,
    opened.dispose,
    input.correlationId,
    input.signal
  )
}

export function logSafeModelFailure(correlationId: string, error: unknown) {
  if (error instanceof SafeModelRequestError) {
    console.warn("Custom model request failed", {
      correlationId,
      phase: error.phase,
      code: error.code
    })
    return
  }

  console.warn("Custom model request failed", {
    correlationId,
    phase: "upstream",
    code: "unexpected_error"
  })
}
