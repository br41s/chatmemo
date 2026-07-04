import { FileItemChunk } from "@/types"
import { encode } from "gpt-tokenizer"
// Deep import dodges pdf-parse's index.js debug harness, which tries to read
// a test PDF from disk when bundled — same path langchain's PDFLoader used.
import pdfParse from "pdf-parse/lib/pdf-parse.js"
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { CHUNK_OVERLAP, CHUNK_SIZE } from "."

export const processPdf = async (pdf: Blob): Promise<FileItemChunk[]> => {
  const buffer = Buffer.from(await pdf.arrayBuffer())
  const { text } = await pdfParse(buffer)

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  })

  return splitter.splitText(text).map(content => ({
    content,
    tokens: encode(content).length
  }))
}
