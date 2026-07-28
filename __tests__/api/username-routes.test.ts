/**
 * @jest-environment node
 */
import { POST as checkAvailability } from "../../app/api/username/available/route"
import { POST as getUsername } from "../../app/api/username/get/route"
import { createClient } from "../../lib/supabase/server"

jest.mock("../../lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("next/headers", () => ({ cookies: jest.fn(() => ({})) }))

const createClientMock = createClient as jest.Mock
const userId = "11111111-1111-4111-8111-111111111111"

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body)
  })
}

function mockSupabase(options?: {
  authenticated?: boolean
  rpcData?: unknown
  rpcError?: unknown
}) {
  const rpc = jest.fn().mockResolvedValue({
    data: options?.rpcData,
    error: options?.rpcError ?? null
  })
  createClientMock.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: options?.authenticated === false ? null : { id: userId }
        },
        error: null
      })
    },
    rpc
  })
  return rpc
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("POST /api/username/available", () => {
  it("returns the boolean from the authenticated RPC", async () => {
    const rpc = mockSupabase({ rpcData: true })

    const response = await checkAvailability(
      request("/api/username/available", { username: "available_name" })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ isAvailable: true })
    expect(rpc).toHaveBeenCalledWith("is_username_available", {
      p_username: "available_name"
    })
  })

  it("rejects unauthenticated callers before the RPC", async () => {
    const rpc = mockSupabase({ authenticated: false })

    const response = await checkAvailability(
      request("/api/username/available", { username: "available_name" })
    )

    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects invalid and oversized requests", async () => {
    const invalidResponse = await checkAvailability(
      request("/api/username/available", { username: "bad name" })
    )
    const oversizedResponse = await checkAvailability(
      request("/api/username/available", { username: "a".repeat(2000) })
    )

    expect(invalidResponse.status).toBe(400)
    expect(oversizedResponse.status).toBe(413)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it("does not expose database errors", async () => {
    mockSupabase({ rpcError: { message: "sensitive database detail" } })

    const response = await checkAvailability(
      request("/api/username/available", { username: "available_name" })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      message: "Username lookup failed"
    })
  })
})

describe("POST /api/username/get", () => {
  it("returns only the username from the authenticated RPC", async () => {
    const rpc = mockSupabase({ rpcData: "public_name" })

    const response = await getUsername(request("/api/username/get", { userId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      username: "public_name"
    })
    expect(rpc).toHaveBeenCalledWith("get_username_by_user_id", {
      p_user_id: userId
    })
  })

  it("returns 404 without exposing profile data when no username exists", async () => {
    mockSupabase({ rpcData: null })

    const response = await getUsername(request("/api/username/get", { userId }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      message: "Username not found"
    })
  })

  it("rejects invalid IDs and unauthenticated callers", async () => {
    const invalidResponse = await getUsername(
      request("/api/username/get", { userId: "not-a-uuid" })
    )
    const rpc = mockSupabase({ authenticated: false })
    const unauthenticatedResponse = await getUsername(
      request("/api/username/get", { userId })
    )

    expect(invalidResponse.status).toBe(400)
    expect(unauthenticatedResponse.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})
