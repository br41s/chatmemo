import { FileItemChunk } from "@/types"
import { encode } from "gpt-tokenizer"
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { CHUNK_OVERLAP, CHUNK_SIZE } from "."

export const processDocX = async (text: string): Promise<FileItemChunk[]> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  })

  return splitter.splitText(text).map(content => ({
    content,
    tokens: encode(content).length
  }))
}
