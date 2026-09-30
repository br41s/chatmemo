/**
 * @jest-environment node
 */
import { POST } from "../../app/api/memory/recall/route"
import { recallPreviewFor } from "../../lib/server/inject-memory"
import { requireUser } from "../../lib/server/require-user"

jest.mock("../../lib/server/require-user", () => ({ requireUser: jest.fn() }))
jest.mock("../../lib/server/inject-memory", () => ({
  recallPreviewFor: jest.fn()
}))

const mockRequireUser = jest.mocked(requireUser)
const mockRecallPreviewFor = jest.mocked(recallPreviewFor)

function request(body: unknown) {
  return new Request("http://localhost/api/memory/recall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

const preview = {
  items: [{ title: "Qatar refund", source: "chatgpt" as const }],
  transcript: false
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {} as any, userId: "user-1" })
  mockRecallPreviewFor.mockResolvedValue(preview)
})

it("names the matches for the signed-in user, with the turn's own budget", async () => {
  const contextBudget = { windowTokens: 128_000 }

  const response = await POST(
    request({ lastUserText: "what about the Qatar refund?", contextBudget })
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(preview)
  expect(mockRecallPreviewFor).toHaveBeenCalledWith(
    "user-1",
    "what about the Qatar refund?",
    contextBudget
  )
})

it("answers 401 without a session and searches nothing", async () => {
  mockRequireUser.mockResolvedValue({
    response: new Response(null, { status: 401 })
  })

  const response = await POST(request({ lastUserText: "hi" }))

  expect(response.status).toBe(401)
  expect(mockRecallPreviewFor).not.toHaveBeenCalled()
})

it("cannot be pointed at another user's memory", async () => {
  // The user comes from the session and nowhere else: a body naming one is
  // refused rather than ignored, so a caller cannot even believe it worked.
  const response = await POST(request({ lastUserText: "hi", userId: "other" }))

  expect(response.status).toBe(400)
  expect(mockRecallPreviewFor).not.toHaveBeenCalled()
})
