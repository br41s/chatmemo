import { FileItemChunk } from "@/types"
import { encode } from "gpt-tokenizer"
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { CHUNK_OVERLAP, CHUNK_SIZE } from "."

export const processTxt = async (txt: Blob): Promise<FileItemChunk[]> => {
  const fileBuffer = Buffer.from(await txt.arrayBuffer())
  const textDecoder = new TextDecoder("utf-8")
  const textContent = textDecoder.decode(fileBuffer)

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  })

  return splitter.splitText(textContent).map(content => ({
    content,
    tokens: encode(content).length
  }))
}
