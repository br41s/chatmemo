/** @jest-environment node */

import { POST } from "../../app/api/retrieval/retrieve/route"
import { generateLocalEmbedding } from "../../lib/generate-local-embedding"
import { generateOpenAIEmbeddings } from "../../lib/server/openai-embeddings"
import { getServerProfile } from "../../lib/server/server-chat-helpers"
import { createClient } from "../../lib/supabase/server"

jest.mock("../../lib/generate-local-embedding", () => ({
  generateLocalEmbedding: jest.fn()
}))
jest.mock("../../lib/server/openai-embeddings", () => {
  const actual = jest.requireActual("../../lib/server/openai-embeddings")
  return { ...actual, generateOpenAIEmbeddings: jest.fn() }
})
jest.mock("../../lib/server/server-chat-helpers", () => ({
  checkApiKey: jest.fn(),
  getServerProfile: jest.fn()
}))
jest.mock("../../lib/supabase/server", () => ({
  createClient: jest.fn()
}))
jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({ session: "cookie-store" }))
}))

const FILE_ID = "123e4567-e89b-42d3-a456-426614174000"
const SECOND_FILE_ID = "223e4567-e89b-42d3-a456-426614174000"
const USER_ID = "323e4567-e89b-42d3-a456-426614174000"

const mockGenerateLocalEmbedding = jest.mocked(generateLocalEmbedding)
const mockGenerateOpenAIEmbeddings = jest.mocked(generateOpenAIEmbeddings)
const mockGetServerProfile = jest.mocked(getServerProfile)
const mockCreateClient = jest.mocked(createClient)

function createRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/retrieval/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userInput: "What does the file say?",
      fileIds: [FILE_ID],
      embeddingsProvider: "local",
      sourceCount: 4,
      ...overrides
    })
  })
}

function mockSupabase(options: {
  userId?: string | null
  visibleIds?: string[]
  filesError?: unknown
  rpcData?: unknown[]
  rpcError?: unknown
}) {
  const inQuery = jest.fn().mockResolvedValue({
    data: (options.visibleIds ?? [FILE_ID]).map(id => ({ id })),
    error: options.filesError ?? null
  })
  const select = jest.fn(() => ({ in: inQuery }))
  const from = jest.fn(() => ({ select }))
  const getUser = jest.fn().mockResolvedValue({
    data: {
      user:
        options.userId === null
          ? null
          : { id: options.userId === undefined ? USER_ID : options.userId }
    },
    error: null
  })
  const rpc = jest.fn().mockResolvedValue({
    data: options.rpcData ?? [
      {
        id: "423e4567-e89b-42d3-a456-426614174000",
        file_id: FILE_ID,
        content: "Stored content",
        tokens: 2,
        similarity: 0.9
      }
    ],
    error: options.rpcError ?? null
  })

  mockCreateClient.mockReturnValue({
    auth: { getUser },
    from,
    rpc
  } as any)

  return { from, getUser, inQuery, rpc, select }
}

describe("POST /api/retrieval/retrieve", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerProfile.mockResolvedValue({
      user_id: USER_ID,
      use_azure_openai: false,
      openai_api_key: null,
      openai_organization_id: null
    } as any)
    mockGenerateLocalEmbedding.mockResolvedValue([0.1, 0.2])
    mockGenerateOpenAIEmbeddings.mockResolvedValue([[0.3, 0.4]])
  })

  it("rejects invalid file IDs before authentication", async () => {
    const response = await POST(createRequest({ fileIds: ["not-a-uuid"] }))

    expect(response.status).toBe(400)
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockGenerateLocalEmbedding).not.toHaveBeenCalled()
  })

  it("requires an authenticated session", async () => {
    mockSupabase({ userId: null })

    const request = createRequest()
    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockGenerateLocalEmbedding).not.toHaveBeenCalled()
  })

  it("rejects a partially visible ID set before generating embeddings", async () => {
    const query = mockSupabase({ visibleIds: [FILE_ID] })

    const response = await POST(
      createRequest({ fileIds: [FILE_ID, SECOND_FILE_ID] })
    )

    expect(response.status).toBe(403)
    expect(query.inQuery).toHaveBeenCalledWith("id", [FILE_ID, SECOND_FILE_ID])
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockGenerateLocalEmbedding).not.toHaveBeenCalled()
    expect(query.rpc).not.toHaveBeenCalled()
  })

  it("retrieves every RLS-visible file through the session client", async () => {
    const query = mockSupabase({ visibleIds: [FILE_ID, SECOND_FILE_ID] })
    const request = createRequest({
      fileIds: [FILE_ID, FILE_ID, SECOND_FILE_ID],
      sourceCount: 6
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: [expect.objectContaining({ similarity: 0.9 })]
    })
    expect(mockGenerateLocalEmbedding).toHaveBeenCalledWith(
      "What does the file say?",
      request.signal
    )
    expect(query.rpc).toHaveBeenCalledWith("match_file_items_local", {
      query_embedding: [0.1, 0.2],
      match_count: 6,
      file_ids: [FILE_ID, SECOND_FILE_ID]
    })
  })

  it("uses the OpenAI embedding helper before the RLS-scoped RPC", async () => {
    const query = mockSupabase({ visibleIds: [FILE_ID] })
    const request = createRequest({ embeddingsProvider: "openai" })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockGenerateOpenAIEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID }),
      "What does the file say?",
      request.signal
    )
    expect(query.rpc).toHaveBeenCalledWith("match_file_items_openai", {
      query_embedding: [0.3, 0.4],
      match_count: 4,
      file_ids: [FILE_ID]
    })
  })

  it("returns a generic server error when the RLS-scoped RPC fails", async () => {
    mockSupabase({ rpcError: { message: "database detail" } })

    const response = await POST(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      message: "An unexpected error occurred"
    })
  })
})
