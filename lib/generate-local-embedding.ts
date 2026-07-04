import { pipeline } from "@huggingface/transformers"

export async function generateLocalEmbedding(content: string) {
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
