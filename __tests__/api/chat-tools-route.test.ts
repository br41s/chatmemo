/** @jest-environment node */

import { POST } from "../../app/api/chat/tools/route"
import { openapiToFunctions } from "../../lib/openapi-conversion"
import {
  checkApiKey,
  getServerProfile
} from "../../lib/server/server-chat-helpers"
import { safeToolRequest } from "../../lib/server/safe-tool-request"
import { openAIStreamResponse } from "../../lib/server/streaming"
import { createClient } from "../../lib/supabase/server"
import OpenAI from "openai"

jest.mock("../../lib/openapi-conversion", () => ({
  openapiToFunctions: jest.fn()
}))
jest.mock("../../lib/server/server-chat-helpers", () => ({
  checkApiKey: jest.fn(),
  getServerProfile: jest.fn()
}))
jest.mock("../../lib/server/safe-tool-request", () => {
  const actual = jest.requireActual("../../lib/server/safe-tool-request")
  return { ...actual, safeToolRequest: jest.fn() }
})
jest.mock("../../lib/server/streaming", () => ({
  openAIStreamResponse: jest.fn(() => new Response("stream"))
}))
jest.mock("../../lib/supabase/server", () => ({
  createClient: jest.fn()
}))
jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({}))
}))
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn()
}))

const TOOL_ID = "123e4567-e89b-42d3-a456-426614174000"
const OWNER_ID = "223e4567-e89b-42d3-a456-426614174000"
const OTHER_USER_ID = "323e4567-e89b-42d3-a456-426614174000"
const mockOpenapiToFunctions = jest.mocked(openapiToFunctions)
const mockGetServerProfile = jest.mocked(getServerProfile)
const mockCheckApiKey = jest.mocked(checkApiKey)
const mockSafeToolRequest = jest.mocked(safeToolRequest)
const mockOpenAIStreamResponse = jest.mocked(openAIStreamResponse)
const mockCreateClient = jest.mocked(createClient)
const mockOpenAI = jest.mocked(OpenAI)

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chat/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

function mockStoredTools(data: unknown[] | null, error: unknown = null) {
  const rows = data?.map(row => ({ user_id: OWNER_ID, ...(row as object) }))
  const inQuery = jest.fn().mockResolvedValue({ data: rows ?? data, error })
  const select = jest.fn(() => ({ in: inQuery }))
  const from = jest.fn(() => ({ select }))
  mockCreateClient.mockReturnValue({ from } as any)

  return { from, select, inQuery }
}

describe("POST /api/chat/tools", () => {
  const completionsCreate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerProfile.mockResolvedValue({
      user_id: OWNER_ID,
      openai_api_key: "server-openai-key",
      openai_organization_id: null
    } as any)
    mockOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create: completionsCreate } }
        }) as any
    )
    mockSafeToolRequest.mockResolvedValue({ ok: true })
    mockOpenapiToFunctions.mockResolvedValue({
      info: {
        title: "Stored tool",
        description: "Loaded from the database",
        server: "https://api.example.com"
      },
      routes: [
        {
          path: "/data",
          method: "get",
          operationId: "getData",
          requestInBody: false
        }
      ],
      functions: [
        {
          type: "function",
          function: {
            name: "getData",
            description: "Get data",
            parameters: { type: "object", properties: {} }
          }
        }
      ]
    } as any)
    completionsCreate.mockResolvedValue({
      choices: [
        { message: { role: "assistant", content: "No tool call needed" } }
      ]
    })
  })

  it("rejects invalid tool IDs before loading profile or database state", async () => {
    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: ["not-a-uuid"]
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: "Selected tool IDs are invalid"
    })
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("rejects an oversized request before loading profile or database state", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat/tools", {
        method: "POST",
        headers: {
          "Content-Length": String(2 * 1024 * 1024 + 1),
          "Content-Type": "application/json"
        },
        body: "{}"
      })
    )

    expect(response.status).toBe(413)
    expect(mockGetServerProfile).not.toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("returns 403 when RLS does not make every selected tool available", async () => {
    mockStoredTools([])

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(response.status).toBe(403)
    expect(completionsCreate).not.toHaveBeenCalled()
  })

  it("loads schema and headers from the database instead of the client", async () => {
    const storedSchema = { source: "database" }
    const query = mockStoredTools([
      {
        id: TOOL_ID,
        schema: storedSchema,
        custom_headers: { Authorization: "Bearer stored-secret" }
      }
    ])

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID],
        selectedTools: [
          {
            id: TOOL_ID,
            schema: { source: "attacker" },
            custom_headers: { Host: "127.0.0.1" }
          }
        ]
      })
    )

    expect(response.status).toBe(200)
    expect(mockOpenapiToFunctions).toHaveBeenCalledWith(storedSchema)
    expect(query.select).toHaveBeenCalledWith(
      "id, user_id, schema, custom_headers"
    )
    expect(query.inQuery).toHaveBeenCalledWith("id", [TOOL_ID])
    expect(mockCheckApiKey).toHaveBeenCalledWith("server-openai-key", "OpenAI")
    expect(completionsCreate).toHaveBeenCalledTimes(1)
  })

  it("accepts IDs from a cached legacy client without trusting its tool data", async () => {
    const storedSchema = { source: "database" }
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: storedSchema,
        custom_headers: {}
      }
    ])

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedTools: [
          {
            id: TOOL_ID,
            schema: { source: "attacker" },
            custom_headers: { Host: "127.0.0.1" }
          }
        ]
      })
    )

    expect(response.status).toBe(200)
    expect(mockOpenapiToFunctions).toHaveBeenCalledWith(storedSchema)
  })

  it("rejects a foreign shared tool with stored headers even if RLS exposes it", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        user_id: OTHER_USER_ID,
        schema: { source: "database" },
        custom_headers: { Authorization: "Bearer owner-secret" }
      }
    ])

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      message: "Shared tools cannot expose custom headers"
    })
    expect(completionsCreate).not.toHaveBeenCalled()
    expect(mockSafeToolRequest).not.toHaveBeenCalled()
  })

  it("rejects unsafe stored headers before invoking the model", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: { source: "database" },
        custom_headers: { Host: "127.0.0.1" }
      }
    ])

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: "Tool header Host is not allowed"
    })
    expect(completionsCreate).not.toHaveBeenCalled()
  })

  it("rejects an invalid stored schema instead of silently dropping the tool", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: { source: "database" },
        custom_headers: {}
      }
    ])
    mockOpenapiToFunctions.mockRejectedValue(new Error("invalid OpenAPI"))

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: "Selected tool schema is invalid"
    })
    expect(completionsCreate).not.toHaveBeenCalled()
  })

  it("bounds the number of tool calls requested by the model", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: { source: "database" },
        custom_headers: {}
      }
    ])
    completionsCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: Array.from({ length: 11 }, (_, index) => ({
              id: `call-${index}`,
              type: "function",
              function: { name: "getData", arguments: "{}" }
            }))
          }
        }
      ]
    })

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      message: "The model requested too many tool calls"
    })
    expect(completionsCreate).toHaveBeenCalledTimes(1)
  })

  it("executes a tool call only with the stored URL and headers", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: { source: "database" },
        custom_headers: { Authorization: "Bearer stored-secret" }
      }
    ])
    const streamedResponse = { stream: true }
    completionsCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "getData",
                    arguments: JSON.stringify({ parameters: { q: "stored" } })
                  }
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce(streamedResponse)

    const response = await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID],
        selectedTools: [
          {
            id: TOOL_ID,
            schema: { source: "attacker" },
            custom_headers: { Authorization: "Bearer attacker-secret" }
          }
        ]
      })
    )

    expect(response.status).toBe(200)
    expect(mockSafeToolRequest).toHaveBeenCalledWith(
      new URL("https://api.example.com/data?q=stored"),
      {
        method: "GET",
        headers: { Authorization: "Bearer stored-secret" },
        signal: expect.anything(),
        timeoutMs: expect.any(Number)
      }
    )
    expect(mockOpenAIStreamResponse).toHaveBeenCalledWith(streamedResponse)
  })

  it("uses the method and body mode of the exact selected operation", async () => {
    mockStoredTools([
      {
        id: TOOL_ID,
        schema: { source: "database" },
        custom_headers: {}
      }
    ])
    mockOpenapiToFunctions.mockResolvedValue({
      info: {
        title: "Mixed tool",
        description: "Mixed operations",
        server: "https://api.example.com"
      },
      routes: [
        {
          path: "/read/{id}",
          method: "get",
          operationId: "readData",
          requestInBody: false
        },
        {
          path: "/write/{id}",
          method: "post",
          operationId: "writeData",
          requestInBody: true
        }
      ],
      functions: [
        { type: "function", function: { name: "readData" } },
        { type: "function", function: { name: "writeData" } }
      ]
    } as any)
    completionsCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "writeData",
                    arguments: JSON.stringify({
                      parameters: { id: "42", trace: "yes" },
                      requestBody: { value: "stored" }
                    })
                  }
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({ stream: true })

    await POST(
      createRequest({
        chatSettings: { model: "gpt-4o" },
        messages: [],
        selectedToolIds: [TOOL_ID]
      })
    )

    expect(mockSafeToolRequest).toHaveBeenCalledWith(
      new URL("https://api.example.com/write/42?id=42&trace=yes"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "stored" }),
        signal: expect.anything(),
        timeoutMs: expect.any(Number)
      }
    )
  })
})
