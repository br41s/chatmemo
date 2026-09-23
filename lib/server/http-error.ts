/** An error whose message is safe to show the user, with its HTTP status. */
export class HttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

export function jsonErrorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

/** request.json(), but a malformed body is a 400 instead of a crash. */
export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError("Request body must be valid JSON", 400)
  }
}

/**
 * Turns anything a chat route throws into the JSON error the client toasts.
 * Our own HttpErrors pass through; provider SDK errors are described by
 * describeProviderError.
 */
export function providerErrorResponse(error: unknown, providerName: string) {
  if (error instanceof HttpError) {
    return jsonErrorResponse(error.message, error.status)
  }

  console.error(`${providerName} request failed:`, error)
  const { message, status } = describeProviderError(error, providerName)
  return jsonErrorResponse(message, status)
}

/**
 * Maps a provider SDK error (openai, @anthropic-ai/sdk, @google/generative-ai)
 * to the message and status the user sees.
 *
 * SDK error shapes:
 * - openai / anthropic: `status` (number) and `message`; a bad key is 401.
 * - google: `status` may be undefined; a bad key is a 400 whose message
 *   contains "API key not valid".
 */
export function describeProviderError(
  error: unknown,
  providerName: string
): { message: string; status: number } {
  const { message, status } = (error ?? {}) as {
    message?: unknown
    status?: unknown
  }
  const text = typeof message === "string" && message ? message : ""
  const code =
    typeof status === "number" && status >= 400 && status <= 599 ? status : 500

  if (code === 401 || /api key not valid/i.test(text)) {
    return {
      message: `${providerName} API Key is incorrect. Please fix it in your profile settings.`,
      status: code
    }
  }

  return { message: text || "An unexpected error occurred", status: code }
}
