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

export async function generateLocalEmbedding(content: string) {
  let pipeline: any
  try {
    ;({ pipeline } = await importTransformers())
  } catch {
    throw new Error(
      "Local embeddings are unavailable on this deployment (serverless " +
        "functions do not ship the model runtime). Use OpenAI embeddings, " +
        "or run ChatMemo self-hosted for local embeddings."
    )
  }

  // dtype q8 matches the quantized default of the old @xenova/transformers
  // v2, keeping new embeddings numerically consistent with vectors already
  // stored in the DB.
  const generateEmbedding = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { dtype: "q8" }
  )

  const output = await generateEmbedding(content, {
    pooling: "mean",
    normalize: true
  })

  const embedding = Array.from(output.data)

  return embedding
}
