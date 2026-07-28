const SENSITIVE_NAMES = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientpassword",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "key",
  "ocpapimsubscriptionkey",
  "password",
  "passwd",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "setcookie",
  "signature",
  "subscriptionkey",
  "token"
])

const EMBEDDED_SECRET_PATTERN =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bbot[0-9]{5,}:[A-Za-z0-9_-]{20,}\b|hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{10,}|discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]{20,})/i

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isSensitiveName(value: string) {
  const normalized = normalizeName(value)
  return (
    SENSITIVE_NAMES.has(normalized) ||
    (normalized.startsWith("x") && SENSITIVE_NAMES.has(normalized.slice(1)))
  )
}

function isNonEmpty(value: unknown) {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value).length > 0
  return true
}

function isSecretWebhookUrl(url: URL) {
  const hostname = url.hostname.toLowerCase()
  const pathname = url.pathname.toLowerCase()

  return (
    /^(?:hook|hooks|webhook)\./.test(hostname) ||
    hostname.endsWith(".m.pipedream.net") ||
    /\/(?:webhooks?|hooks\/catch)(?:\/|$)/.test(pathname) ||
    /\/with\/key(?:\/|$)/.test(pathname)
  )
}

function urlContainsCredentials(value: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return true
    if (url.search || url.hash) return true
    if (isSecretWebhookUrl(url)) return true

    return false
  } catch {
    return /:\/\/[^/?#\s]+@/.test(value)
  }
}

function valueContainsCredentials(
  value: unknown,
  visited: WeakSet<object>
): boolean {
  if (typeof value === "string") {
    return EMBEDDED_SECRET_PATTERN.test(value)
  }

  if (typeof value !== "object" || value === null) return false
  if (visited.has(value)) return false
  visited.add(value)

  if (Array.isArray(value)) {
    return value.some(item => valueContainsCredentials(item, visited))
  }

  const object = value as Record<string, unknown>
  const location =
    typeof object.in === "string" ? object.in.toLowerCase() : undefined
  const parameterName =
    typeof object.name === "string" ? object.name : undefined

  if (
    parameterName &&
    isSensitiveName(parameterName) &&
    (location === "header" || location === "query" || location === "cookie")
  ) {
    return true
  }

  for (const [key, nestedValue] of Object.entries(object)) {
    const normalizedKey = normalizeName(key)

    if (
      (normalizedKey === "security" || normalizedKey === "securityschemes") &&
      isNonEmpty(nestedValue)
    ) {
      return true
    }

    if (isSensitiveName(normalizedKey)) {
      return true
    }

    if (
      normalizedKey === "url" &&
      typeof nestedValue === "string" &&
      urlContainsCredentials(nestedValue)
    ) {
      return true
    }

    if (valueContainsCredentials(nestedValue, visited)) return true
  }

  return false
}

export function isShareableToolUrl(value: unknown) {
  if (value === "") return true
  if (typeof value !== "string" || value.length > 2048) return false
  if (EMBEDDED_SECRET_PATTERN.test(value)) return false

  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      !isSecretWebhookUrl(url)
    )
  } catch {
    return false
  }
}

export function isShareableToolSchema(value: unknown) {
  let schema = value
  if (typeof value === "string") {
    try {
      schema = JSON.parse(value)
    } catch {
      return false
    }
  }

  return !valueContainsCredentials(schema, new WeakSet())
}

export function isShareableToolConfig(schema: unknown, url: unknown) {
  return isShareableToolUrl(url) && isShareableToolSchema(schema)
}
