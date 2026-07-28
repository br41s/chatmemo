/** @jest-environment node */

import { POST } from "../../app/api/retrieval/process/docx/route"
import { generateLocalEmbeddings } from "../../lib/generate-local-embedding"
import { processDocX } from "../../lib/retrieval/processing"
import { MAX_LOCAL_DOCX_TEXT_CHARS } from "../../lib/retrieval/limits"
import { getServerProfile } from "../../lib/server/server-chat-helpers"
import { createClient } from "../../lib/supabase/server"

jest.mock("../../lib/generate-local-embedding", () => ({
  generateLocalEmbeddings: jest.fn()
}))
jest.mock("../../lib/retrieval/processing", () => ({
  processDocX: jest.fn()
}))
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
const USER_ID = "223e4567-e89b-42d3-a456-426614174000"
const OTHER_USER_ID = "323e4567-e89b-42d3-a456-426614174000"

const mockGenerateLocalEmbeddings = jest.mocked(generateLocalEmbeddings)
const mockProcessDocX = jest.mocked(processDocX)
const mockGetServerProfile = jest.mocked(getServerProfile)
const mockCreateClient = jest.mocked(createClient)

function createRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/retrieval/process/docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Extracted DOCX text",
      fileId: FILE_ID,
      embeddingsProvider: "local",
      fileExtension: "docx",
      ...overrides
    })
  })
}

function mockSupabase(options: {
  userId?: string | null
  fileOwnerId?: string | null
  fileError?: unknown
  replaceError?: unknown
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data:
      options.fileOwnerId === null
        ? null
        : {
            id: FILE_ID,
            user_id: options.fileOwnerId ?? USER_ID
          },
    error: options.fileError ?? null
  })
  const lookupEq = jest.fn(() => ({ maybeSingle }))
  const select = jest.fn(() => ({ eq: lookupEq }))
  const rpc = jest.fn().mockResolvedValue({
    error: options.replaceError ?? null
  })
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

  mockCreateClient.mockReturnValue({ auth: { getUser }, from, rpc } as any)

  return {
    from,
    getUser,
    lookupEq,
    maybeSingle,
    rpc,
    select
  }
}

describe("POST /api/retrieval/process/docx", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerProfile.mockResolvedValue({
      user_id: USER_ID,
      use_azure_openai: false,
      openai_api_key: null,
      openai_organization_id: null
    } as any)
    mockProcessDocX.mockResolvedValue([
      { content: "First chunk", tokens: 2 },
      { content: "Second chunk", tokens: 3 }
    ])
    mockGenerateLocalEmbeddings.mockResolvedValue([[0.1], [0.2]])
  })

  it("authenticates before reading and validating the request body", async () => {
    const query = mockSupabase({})
    const response = await POST(createRequest({ fileId: "not-a-uuid" }))

    expect(response.status).toBe(400)
    expect(query.getUser).toHaveBeenCalledTimes(1)
    expect(mockProcessDocX).not.toHaveBeenCalled()
  })

  it("rejects oversized local text after authentication", async () => {
    const query = mockSupabase({})
    const response = await POST(
      createRequest({ text: "x".repeat(MAX_LOCAL_DOCX_TEXT_CHARS + 1) })
    )

    expect(response.status).toBe(400)
    expect(query.getUser).toHaveBeenCalledTimes(1)
    expect(mockProcessDocX).not.toHaveBeenCalled()
  })

  it("requires an authenticated session", async () => {
    mockSupabase({ userId: null })

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockProcessDocX).not.toHaveBeenCalled()
  })

  it("rejects a foreign file before processing or writing", async () => {
    const query = mockSupabase({ fileOwnerId: OTHER_USER_ID })

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(query.select).toHaveBeenCalledWith("id, user_id")
    expect(query.lookupEq).toHaveBeenCalledWith("id", FILE_ID)
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockProcessDocX).not.toHaveBeenCalled()
    expect(query.rpc).not.toHaveBeenCalled()
  })

  it("writes chunks and metadata only for the authenticated owner", async () => {
    const query = mockSupabase({ fileOwnerId: USER_ID })
    const request = createRequest()

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockGenerateLocalEmbeddings).toHaveBeenCalledWith(
      ["First chunk", "Second chunk"],
      request.signal
    )
    expect(query.rpc).toHaveBeenCalledWith("replace_file_items", {
      p_file_id: FILE_ID,
      p_items: [
        expect.objectContaining({
          file_id: FILE_ID,
          user_id: USER_ID,
          content: "First chunk",
          tokens: 2,
          local_embedding: [0.1]
        }),
        expect.objectContaining({
          file_id: FILE_ID,
          user_id: USER_ID,
          content: "Second chunk",
          tokens: 3,
          local_embedding: [0.2]
        })
      ],
      p_total_tokens: 5
    })
  })

  it("reports a failed file-items write instead of returning success", async () => {
    const query = mockSupabase({ replaceError: { message: "write failed" } })

    const response = await POST(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      message: "File items could not be saved"
    })
    expect(query.rpc).toHaveBeenCalledTimes(1)
  })

  it("does not write partial chunks when a local embedding fails", async () => {
    const query = mockSupabase({})
    mockGenerateLocalEmbeddings.mockRejectedValueOnce(
      new Error("local model failed")
    )

    const response = await POST(createRequest())

    expect(response.status).toBe(500)
    expect(query.rpc).not.toHaveBeenCalled()
  })
})
