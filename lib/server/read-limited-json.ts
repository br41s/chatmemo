export class LimitedJsonError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "LimitedJsonError"
    this.status = status
  }
}

async function readLimitedBody(
  request: Request,
  options: { maxBytes: number; timeoutMs: number }
) {
  const rawContentLength = request.headers.get("content-length")
  if (rawContentLength) {
    const contentLength = Number(rawContentLength)
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > options.maxBytes
    ) {
      throw new LimitedJsonError("Request body is too large", 413)
    }
  }

  if (!request.body) {
    throw new LimitedJsonError("Request body is required", 400)
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const deadline = Date.now() + options.timeoutMs

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      await reader.cancel()
      throw new LimitedJsonError("Request body timed out", 408)
    }

    const { done, value } = await new Promise<
      ReadableStreamReadResult<Uint8Array>
    >((resolve, reject) => {
      const timeout = setTimeout(() => {
        void reader.cancel()
        reject(new LimitedJsonError("Request body timed out", 408))
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
    if (totalBytes > options.maxBytes) {
      await reader.cancel()
      throw new LimitedJsonError("Request body is too large", 413)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export async function readLimitedJson(
  request: Request,
  options: { maxBytes: number; timeoutMs: number }
) {
  const body = await readLimitedBody(request, options)

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    return JSON.parse(text) as unknown
  } catch {
    throw new LimitedJsonError("Request body must be valid JSON", 400)
  }
}

export async function readLimitedFormData(
  request: Request,
  options: { maxBytes: number; timeoutMs: number }
) {
  const contentType = request.headers.get("content-type")
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new LimitedJsonError("Request body must be multipart form data", 400)
  }

  const body = await readLimitedBody(request, options)
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body
    }).formData()
  } catch {
    throw new LimitedJsonError("Request body must be valid form data", 400)
  }
}
