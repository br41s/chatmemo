/** @jest-environment node */

import { POST } from "../../app/api/retrieval/process/route"
import { generateLocalEmbeddings } from "../../lib/generate-local-embedding"
import { processTxt } from "../../lib/retrieval/processing"
import { generateOpenAIEmbeddings } from "../../lib/server/openai-embeddings"
import { getServerProfile } from "../../lib/server/server-chat-helpers"
import { createClient as createSessionClient } from "../../lib/supabase/server"

jest.mock("../../lib/generate-local-embedding", () => ({
  generateLocalEmbeddings: jest.fn()
}))
jest.mock("../../lib/retrieval/processing", () => ({
  processCSV: jest.fn(),
  processJSON: jest.fn(),
  processMarkdown: jest.fn(),
  processPdf: jest.fn(),
  processTxt: jest.fn()
}))
jest.mock("../../lib/server/openai-embeddings", () => ({
  EmbeddingRequestError: class EmbeddingRequestError extends Error {},
  generateOpenAIEmbeddings: jest.fn()
}))
jest.mock("../../lib/server/server-chat-helpers", () => ({
  getServerProfile: jest.fn()
}))
jest.mock("../../lib/supabase/server", () => ({
  createClient: jest.fn()
}))
jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({ session: "cookie-store" }))
}))

const FILE_ID = "123e4567-e89b-42d3-a456-426614174000"
const USER_ID = "223e4567-e89b-42d3-a456-426614174000"
const OTHER_USER_ID = "323e4567-e89b-42d3-a456-426614174000"

const mockCreateSessionClient = jest.mocked(createSessionClient)
const mockGenerateLocalEmbeddings = jest.mocked(generateLocalEmbeddings)
const mockGenerateOpenAIEmbeddings = jest.mocked(generateOpenAIEmbeddings)
const mockGetServerProfile = jest.mocked(getServerProfile)
const mockProcessTxt = jest.mocked(processTxt)

function createRequest(overrides: Record<string, string> = {}) {
  const form = new FormData()
  form.set("file_id", overrides.file_id ?? FILE_ID)
  form.set("embeddingsProvider", overrides.embeddingsProvider ?? "openai")
  return new Request("http://localhost/api/retrieval/process", {
    method: "POST",
    body: form
  })
}

function mockSupabase(
  options: {
  ownerId?: string
  filePath?: string
  file?: Blob
  size?: number
    metadataError?: unknown
    downloadError?: unknown
    replaceError?: unknown
  } = {}
) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: {
      id: FILE_ID,
      user_id: options.ownerId ?? USER_ID,
      file_path: options.filePath ?? `${USER_ID}/file`,
      name: "notes.txt",
      size: options.size ?? options.file?.size ?? 5
    },
    error: options.metadataError ?? null
  })
  const eq = jest.fn(() => ({ maybeSingle }))
  const select = jest.fn(() => ({ eq }))
  const from = jest.fn(() => ({ select }))
  const download = jest.fn().mockResolvedValue({
    data: options.file ?? new Blob(["notes"]),
    error: options.downloadError ?? null
  })
  const list = jest.fn().mockResolvedValue({
    data: [
      {
        name: "file",
        metadata: { size: options.file?.size ?? options.size ?? 5 }
      }
    ],
    error: null
  })
  const storageFrom = jest.fn(() => ({ download, list }))
  const rpc = jest
    .fn()
    .mockResolvedValue({ error: options.replaceError ?? null })
  mockCreateSessionClient.mockReturnValue({
    from,
    rpc,
    storage: { from: storageFrom }
  } as any)

  return { download, eq, from, list, maybeSingle, rpc, select, storageFrom }
}

describe("POST /api/retrieval/process", () => {
  const originalFileLimit = process.env.NEXT_PUBLIC_USER_FILE_SIZE_LIMIT

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerProfile.mockResolvedValue({
      user_id: USER_ID,
      use_azure_openai: false,
      openai_api_key: "key",
      openai_organization_id: null
    } as any)
    mockProcessTxt.mockResolvedValue([{ content: "First chunk", tokens: 3 }])
    mockGenerateOpenAIEmbeddings.mockResolvedValue([[0.1]])
    mockGenerateLocalEmbeddings.mockResolvedValue([[0.2]])
    mockSupabase()
  })

  afterEach(() => {
    if (originalFileLimit === undefined) {
      delete process.env.NEXT_PUBLIC_USER_FILE_SIZE_LIMIT
    } else {
      process.env.NEXT_PUBLIC_USER_FILE_SIZE_LIMIT = originalFileLimit
    }
  })

  it("validates the bounded form before reading file metadata", async () => {
    const query = mockSupabase()

    const response = await POST(createRequest({ file_id: "invalid" }))

    expect(response.status).toBe(400)
    expect(query.from).not.toHaveBeenCalled()
    expect(mockProcessTxt).not.toHaveBeenCalled()
  })

  it("rejects a foreign file before downloading or embedding it", async () => {
    const query = mockSupabase({ ownerId: OTHER_USER_ID })

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(query.download).not.toHaveBeenCalled()
    expect(mockGenerateOpenAIEmbeddings).not.toHaveBeenCalled()
    expect(query.rpc).not.toHaveBeenCalled()
  })

  it("rejects an owner row that points at another user's storage path", async () => {
    const query = mockSupabase({ filePath: `${OTHER_USER_ID}/private-file` })

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(query.list).not.toHaveBeenCalled()
    expect(query.download).not.toHaveBeenCalled()
    expect(query.rpc).not.toHaveBeenCalled()
  })

  it("uses the hardened embedding helper and atomic owner RPC", async () => {
    const query = mockSupabase()
    const request = createRequest()

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(query.list).toHaveBeenCalledWith(USER_ID, {
      limit: 100,
      search: "file"
    })
    expect(mockGenerateOpenAIEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID }),
      ["First chunk"],
      request.signal
    )
    expect(query.rpc).toHaveBeenCalledWith("replace_file_items", {
      p_file_id: FILE_ID,
      p_items: [
        expect.objectContaining({
          file_id: FILE_ID,
          user_id: USER_ID,
          content: "First chunk",
          tokens: 3,
          openai_embedding: [0.1]
        })
      ],
      p_total_tokens: 3
    })
  })

  it("rejects an oversized stored file before processing", async () => {
    process.env.NEXT_PUBLIC_USER_FILE_SIZE_LIMIT = "2"
    const query = mockSupabase({ file: new Blob(["three"]), size: 5 })

    const response = await POST(createRequest())

    expect(response.status).toBe(413)
    expect(query.download).not.toHaveBeenCalled()
    expect(mockProcessTxt).not.toHaveBeenCalled()
    expect(query.rpc).not.toHaveBeenCalled()
  })

  it("does not report success when the atomic write fails", async () => {
    mockSupabase({ replaceError: { message: "write failed" } })

    const response = await POST(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      message: "File items could not be saved"
    })
  })
})
