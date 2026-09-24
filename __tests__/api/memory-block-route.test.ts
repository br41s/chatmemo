/**
 * @jest-environment node
 */
import { POST } from "../../app/api/memory/block/route"
import { memoryBlockFor } from "../../lib/server/inject-memory"
import { requireUser } from "../../lib/server/require-user"

jest.mock("../../lib/server/require-user", () => ({ requireUser: jest.fn() }))
jest.mock("../../lib/server/inject-memory", () => ({
  memoryBlockFor: jest.fn()
}))

const mockRequireUser = jest.mocked(requireUser)
const mockMemoryBlockFor = jest.mocked(memoryBlockFor)

function request(body: unknown) {
  return new Request("http://localhost/api/memory/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {} as any, userId: "user-1" })
  mockMemoryBlockFor.mockResolvedValue({
    block: "[CHATMEMO_MEMORY]…",
    report: { injected: true, totalChars: 18, budgetChars: 1000 }
  })
})

it("returns the block and report for the signed-in user", async () => {
  const contextBudget = { windowTokens: 8192 }

  const response = await POST(
    request({ lastUserText: "where did I fly in May?", contextBudget })
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    block: "[CHATMEMO_MEMORY]…",
    report: { injected: true, totalChars: 18, budgetChars: 1000 }
  })
  expect(mockMemoryBlockFor).toHaveBeenCalledWith(
    "user-1",
    "where did I fly in May?",
    contextBudget
  )
})

it("answers 401 without a session and reads no memory", async () => {
  mockRequireUser.mockResolvedValue({
    response: new Response(null, { status: 401 })
  })

  const response = await POST(request({ lastUserText: "hi" }))

  expect(response.status).toBe(401)
  expect(mockMemoryBlockFor).not.toHaveBeenCalled()
})

it("rejects fields it does not know", async () => {
  const response = await POST(request({ lastUserText: "hi", userId: "other" }))

  expect(response.status).toBe(400)
  expect(mockMemoryBlockFor).not.toHaveBeenCalled()
})
