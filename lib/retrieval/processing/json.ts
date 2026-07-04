import { FileItemChunk } from "@/types"
import { encode } from "gpt-tokenizer"
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { CHUNK_OVERLAP, CHUNK_SIZE } from "."

/** Collect every string leaf in a JSON value, depth-first — the same
 *  extraction langchain's JSONLoader performed with no pointers configured. */
function extractStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(extractStrings)
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(extractStrings)
  }
  return []
}

export const processJSON = async (json: Blob): Promise<FileItemChunk[]> => {
  const raw = await json.text()
  const completeText = extractStrings(JSON.parse(raw.trim())).join(" ")

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  })

  return splitter.splitText(completeText).map(content => ({
    content,
    tokens: encode(content).length
  }))
}
