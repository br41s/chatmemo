// @huggingface/transformers is imported through an eval-hidden dynamic
// import so neither webpack nor the file tracer ever sees it. Bundling it
// breaks the build (pre-bundled dist with unresolvable wasm/webgpu refs) and
// externalizing it makes Vercel whole-copy 356MB into every retrieval
// function (over the 250MB limit). Hidden, the functions stay ~7MB.
//
// Consequence: local embeddings work wherever node_modules exists at
// runtime (npm run chat, self-hosted next start). On Vercel serverless the
// package is not shipped, so the optional "local" embeddings provider fails
// with a clear error — OpenAI embeddings (the default) are unaffected.
const importTransformers = () =>
  // eslint-disable-next-line no-new-func
  Function('return import("@huggingface/transformers")')() as Promise<any>

let embeddingPipelinePromise: Promise<any> | null = null
const MAX_LOCAL_EMBEDDING_CONCURRENCY = 2
let activeLocalEmbeddings = 0
const localEmbeddingWaiters: Array<{
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}> = []

function abortedError() {
  const error = new Error("Local embedding request was cancelled")
  error.name = "AbortError"
  return error
}

function releaseLocalEmbeddingSlot() {
  activeLocalEmbeddings -= 1

  while (localEmbeddingWaiters.length > 0) {
    const waiter = localEmbeddingWaiters.shift()!
    if (waiter.signal?.aborted) continue

    activeLocalEmbeddings += 1
    if (waiter.onAbort) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort)
    }
    waiter.resolve(releaseLocalEmbeddingSlot)
    return
  }
}

function acquireLocalEmbeddingSlot(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortedError())

  if (activeLocalEmbeddings < MAX_LOCAL_EMBEDDING_CONCURRENCY) {
    activeLocalEmbeddings += 1
    return Promise.resolve(releaseLocalEmbeddingSlot)
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      signal,
      onAbort: undefined as (() => void) | undefined
    }

    waiter.onAbort = () => {
      const index = localEmbeddingWaiters.indexOf(waiter)
      if (index >= 0) localEmbeddingWaiters.splice(index, 1)
      reject(abortedError())
    }
    signal?.addEventListener("abort", waiter.onAbort, { once: true })
    localEmbeddingWaiters.push(waiter)
  })
}

async function getEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    embeddingPipelinePromise = importTransformers()
      .then(({ pipeline }) =>
        pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          dtype: "q8"
        })
      )
      .catch(error => {
        embeddingPipelinePromise = null
        throw error
      })
  }

  return embeddingPipelinePromise
}

export async function generateLocalEmbedding(
  content: string,
  signal?: AbortSignal
) {
  const release = await acquireLocalEmbeddingSlot(signal)

  let generateEmbedding: any
  try {
    generateEmbedding = await getEmbeddingPipeline()
  } catch {
    release()
    throw new Error(
      "Local embeddings are unavailable on this deployment (serverless " +
        "functions do not ship the model runtime). Use OpenAI embeddings, " +
        "or run ChatMemo self-hosted for local embeddings."
    )
  }

  try {
    if (signal?.aborted) throw abortedError()
    const output = await generateEmbedding(content, {
      pooling: "mean",
      normalize: true,
      truncation: true
    })
    if (signal?.aborted) throw abortedError()

    return Array.from(output.data)
  } finally {
    release()
  }
}

export async function generateLocalEmbeddings(
  contents: string[],
  signal?: AbortSignal,
  concurrency = 2
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Embedding concurrency must be a positive integer")
  }

  const embeddings: unknown[][] = new Array(contents.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < contents.length) {
      const index = nextIndex
      nextIndex += 1
      embeddings[index] = await generateLocalEmbedding(contents[index], signal)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, contents.length) }, worker)
  )

  return embeddings
}
