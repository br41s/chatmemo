import { lookup as dnsLookup } from "node:dns/promises"
import { IncomingHttpHeaders, IncomingMessage } from "node:http"
import { request as httpsRequest, RequestOptions } from "node:https"
import { BlockList, isIP } from "node:net"

const MAX_REDIRECTS = 3
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

const blockedIpv4Addresses = new BlockList()
const blockedIpv6Addresses = new BlockList()

const blockedIpv4Subnets: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]

const blockedIpv6Subnets: Array<[string, number]> = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fec0::", 10],
  ["fe80::", 10],
  ["ff00::", 8]
]

for (const [address, prefix] of blockedIpv4Subnets) {
  blockedIpv4Addresses.addSubnet(address, prefix, "ipv4")
}

for (const [address, prefix] of blockedIpv6Subnets) {
  blockedIpv6Addresses.addSubnet(address, prefix, "ipv6")
}

const blockedHeaders = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via"
])

const blockedHostnameSuffixes = [
  ".home",
  ".internal",
  ".lan",
  ".local",
  ".localdomain",
  ".localhost"
]

const redirectStatuses = new Set([301, 302, 303, 307, 308])

export class UnsafeToolRequestError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "UnsafeToolRequestError"
    this.status = status
  }
}

export interface LookupAddress {
  address: string
  family: number
}

type AddressLookup = (hostname: string) => Promise<LookupAddress[]>

interface ToolRequestInit {
  method: "GET" | "POST"
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}

interface RawToolResponse {
  status: number
  statusText: string
  headers: IncomingHttpHeaders
  body: string
}

type ToolTransport = (
  url: URL,
  init: ToolRequestInit,
  resolvedAddress: LookupAddress,
  timeoutMs: number
) => Promise<RawToolResponse>

interface SafeToolRequestDependencies {
  lookup?: AddressLookup
  transport?: ToolTransport
}

function normalizeHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
}

export function assertSafeToolUrl(rawUrl: string) {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.length > 2048
  ) {
    throw new UnsafeToolRequestError("Tool URL is invalid")
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeToolRequestError("Tool URL is invalid")
  }

  if (url.protocol !== "https:") {
    throw new UnsafeToolRequestError("Tool URL must use HTTPS")
  }

  if (url.username || url.password) {
    throw new UnsafeToolRequestError("Tool URL credentials are not allowed")
  }

  const hostname = normalizeHostname(url.hostname.toLowerCase())
  if (
    hostname === "localhost" ||
    (!isIP(hostname) && !hostname.includes(".")) ||
    blockedHostnameSuffixes.some(suffix => hostname.endsWith(suffix))
  ) {
    throw new UnsafeToolRequestError("Tool hostname is not allowed")
  }

  return url
}

export function isBlockedToolAddress(address: string, family = isIP(address)) {
  const detectedFamily = isIP(address)

  if (family !== detectedFamily) {
    return true
  }

  if (detectedFamily === 4) {
    return blockedIpv4Addresses.check(address, "ipv4")
  }

  if (detectedFamily === 6) {
    return blockedIpv6Addresses.check(address, "ipv6")
  }

  return true
}

const defaultLookup: AddressLookup = hostname =>
  dnsLookup(hostname, { all: true, verbatim: true })

export async function resolvePublicToolAddress(
  url: URL,
  lookup: AddressLookup = defaultLookup
) {
  const hostname = normalizeHostname(url.hostname)
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname)

  if (addresses.length === 0) {
    throw new UnsafeToolRequestError("Tool hostname did not resolve")
  }

  if (
    addresses.some(({ address, family }) =>
      isBlockedToolAddress(address, family)
    )
  ) {
    throw new UnsafeToolRequestError(
      "Tool hostname resolves to a non-public address"
    )
  }

  return addresses[0]
}

export function buildSafeToolUrl(
  serverUrl: string,
  path: string,
  queryParams?: URLSearchParams
) {
  const baseUrl = assertSafeToolUrl(serverUrl)

  if (baseUrl.search || baseUrl.hash) {
    throw new UnsafeToolRequestError(
      "Tool server URL cannot contain a query or fragment"
    )
  }

  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.split("/").some(segment => segment === "." || segment === "..") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new UnsafeToolRequestError("Tool path is invalid")
  }

  const basePath = baseUrl.pathname.replace(/\/$/, "")
  const url = new URL(`${baseUrl.origin}${basePath}${path}`)

  if (url.origin !== baseUrl.origin) {
    throw new UnsafeToolRequestError("Tool URL origin changed unexpectedly")
  }

  if (
    basePath &&
    url.pathname !== basePath &&
    !url.pathname.startsWith(`${basePath}/`)
  ) {
    throw new UnsafeToolRequestError("Tool path escaped its server base path")
  }

  if (queryParams) {
    url.search = queryParams.toString()
  }

  return url
}

export function sanitizeToolHeaders(rawHeaders: unknown) {
  if (rawHeaders === null || rawHeaders === undefined || rawHeaders === "") {
    return {}
  }

  let parsedHeaders: unknown = rawHeaders
  if (typeof rawHeaders === "string") {
    try {
      parsedHeaders = JSON.parse(rawHeaders)
    } catch {
      throw new UnsafeToolRequestError("Tool headers must be valid JSON")
    }
  }

  if (
    typeof parsedHeaders !== "object" ||
    parsedHeaders === null ||
    Array.isArray(parsedHeaders)
  ) {
    throw new UnsafeToolRequestError("Tool headers must be an object")
  }

  const entries = Object.entries(parsedHeaders)
  if (entries.length > 50) {
    throw new UnsafeToolRequestError("Tool has too many custom headers")
  }

  const sanitized: Record<string, string> = {}
  for (const [name, value] of entries) {
    const normalizedName = name.toLowerCase()
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
      blockedHeaders.has(normalizedName) ||
      normalizedName.startsWith("proxy-") ||
      normalizedName.startsWith("sec-") ||
      normalizedName.startsWith("x-forwarded-")
    ) {
      throw new UnsafeToolRequestError(`Tool header ${name} is not allowed`)
    }

    if (
      typeof value !== "string" ||
      value.length > 8192 ||
      /[\r\n]/.test(value)
    ) {
      throw new UnsafeToolRequestError(`Tool header ${name} is invalid`)
    }

    sanitized[name] = value
  }

  return sanitized
}

function withToolTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new UnsafeToolRequestError("Tool request timed out", 504)),
      timeoutMs
    )

    promise.then(
      value => {
        clearTimeout(timeout)
        resolve(value)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function withToolAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(
      new UnsafeToolRequestError("Tool request was cancelled", 499)
    )
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new UnsafeToolRequestError("Tool request was cancelled", 499))
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    )
  })
}

const pinnedHttpsTransport: ToolTransport = (
  url,
  init,
  resolvedAddress,
  timeoutMs
) =>
  new Promise((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let activeResponse: IncomingMessage | undefined
    let abortRequest: (() => void) | undefined

    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (abortRequest) init.signal?.removeEventListener("abort", abortRequest)
    }

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const resolveOnce = (response: RawToolResponse) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }

    const request = httpsRequest(
      url,
      buildPinnedToolRequestOptions(init, resolvedAddress),
      response => {
        activeResponse = response
        const chunks: Buffer[] = []
        let receivedBytes = 0

        response.on("error", rejectOnce)
        response.on("aborted", () => {
          rejectOnce(
            new UnsafeToolRequestError("Tool response was interrupted", 502)
          )
        })
        response.on("close", () => {
          if (!response.complete) {
            rejectOnce(
              new UnsafeToolRequestError("Tool response was interrupted", 502)
            )
          }
        })

        response.on("data", chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          receivedBytes += buffer.length

          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy(
              new UnsafeToolRequestError("Tool response is too large", 502)
            )
            return
          }

          chunks.push(buffer)
        })

        response.on("end", () => {
          resolveOnce({
            status: response.statusCode || 502,
            statusText: response.statusMessage || "Tool request failed",
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        })
      }
    )

    timeout = setTimeout(() => {
      request.destroy(new UnsafeToolRequestError("Tool request timed out", 504))
    }, timeoutMs)
    request.on("error", rejectOnce)

    abortRequest = () => {
      const error = new UnsafeToolRequestError(
        "Tool request was cancelled",
        499
      )
      activeResponse?.destroy(error)
      request.destroy(error)
    }
    init.signal?.addEventListener("abort", abortRequest, { once: true })

    if (init.signal?.aborted) {
      abortRequest()
      return
    }

    if (init.body) {
      request.write(init.body)
    }
    request.end()
  })

export function buildPinnedToolRequestOptions(
  init: ToolRequestInit,
  resolvedAddress: LookupAddress
): RequestOptions {
  return {
    agent: false,
    method: init.method,
    headers: init.headers,
    lookup: ((_hostname: string, options: any, callback: any) => {
      if (options?.all) {
        callback(null, [resolvedAddress])
        return
      }
      callback(null, resolvedAddress.address, resolvedAddress.family)
    }) as any
  }
}

export async function safeToolRequest(
  rawUrl: string | URL,
  init: ToolRequestInit,
  dependencies: SafeToolRequestDependencies = {}
): Promise<unknown> {
  if (init.body && Buffer.byteLength(init.body, "utf8") > MAX_REQUEST_BYTES) {
    throw new UnsafeToolRequestError("Tool request body is too large", 413)
  }

  const lookup = dependencies.lookup || defaultLookup
  const transport = dependencies.transport || pinnedHttpsTransport
  const requestedTimeout = init.timeoutMs ?? REQUEST_TIMEOUT_MS
  const requestTimeout = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(requestedTimeout, 1), REQUEST_TIMEOUT_MS)
    : REQUEST_TIMEOUT_MS
  const deadline = Date.now() + requestTimeout

  const remainingTime = () => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new UnsafeToolRequestError("Tool request timed out", 504)
    }

    return remaining
  }

  let currentUrl = assertSafeToolUrl(rawUrl.toString())
  let currentInit = {
    ...init,
    headers: sanitizeToolHeaders(init.headers)
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    let resolvedAddress: LookupAddress
    let response: RawToolResponse

    try {
      resolvedAddress = await withToolAbort(
        withToolTimeout(
          resolvePublicToolAddress(currentUrl, lookup),
          remainingTime()
        ),
        currentInit.signal
      )
      response = await transport(
        currentUrl,
        currentInit,
        resolvedAddress,
        remainingTime()
      )
    } catch (error) {
      if (error instanceof UnsafeToolRequestError) {
        throw error
      }

      throw new UnsafeToolRequestError("Tool request failed", 502)
    }

    if (redirectStatuses.has(response.status)) {
      const location = response.headers.location
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new UnsafeToolRequestError("Tool redirect is invalid", 502)
      }

      let redirectedUrl: URL
      try {
        redirectedUrl = assertSafeToolUrl(
          new URL(location, currentUrl).toString()
        )
      } catch (error) {
        if (error instanceof UnsafeToolRequestError) {
          throw error
        }

        throw new UnsafeToolRequestError("Tool redirect is invalid", 502)
      }
      if (redirectedUrl.origin !== currentUrl.origin) {
        throw new UnsafeToolRequestError(
          "Tool redirects cannot change origin",
          502
        )
      }

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          currentInit.method === "POST")
      ) {
        currentInit = {
          method: "GET",
          headers: Object.fromEntries(
            Object.entries(currentInit.headers).filter(
              ([name]) => name.toLowerCase() !== "content-type"
            )
          ),
          signal: currentInit.signal
        }
      }

      currentUrl = redirectedUrl
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      return { error: response.statusText }
    }

    try {
      return JSON.parse(response.body)
    } catch {
      throw new UnsafeToolRequestError(
        "Tool response must contain valid JSON",
        502
      )
    }
  }

  throw new UnsafeToolRequestError("Tool redirect limit exceeded", 502)
}
