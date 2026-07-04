import { FileItemChunk } from "@/types"
import { csvParse } from "d3-dsv"
import { encode } from "gpt-tokenizer"
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { CHUNK_OVERLAP, CHUNK_SIZE } from "."

export const processCSV = async (csv: Blob): Promise<FileItemChunk[]> => {
  const raw = await csv.text()

  // One block per row, "column: value" per line — same shape langchain's
  // CSVLoader produced, so new chunks match previously stored ones.
  const rows = csvParse(raw.trim())
  const completeText = rows
    .map(row =>
      Object.keys(row)
        .map(key => `${key.trim()}: ${row[key]?.trim()}`)
        .join("\n")
    )
    .join("\n\n")

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ["\n\n"]
  })

  return splitter.splitText(completeText).map(content => ({
    content,
    tokens: encode(content).length
  }))
}
