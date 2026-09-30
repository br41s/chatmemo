/**
 * @jest-environment node
 *
 * A window too small to hold the block's own text gets no block — and no
 * queries. Sending the instructions alone would spend what little room there
 * is on rules about sections that are not there.
 */
import { memoryBlockFor } from "../../lib/server/inject-memory"
import { getFullConversationForUser } from "../../lib/server/get-full-conversation"
import { getLatestSummaryForUser } from "../../lib/server/get-latest-summary"
import { getRelevantMemoryForUser } from "../../lib/server/get-relevant-memory"

jest.mock("../../lib/server/get-latest-summary", () => ({
  getLatestSummaryForUser: jest.fn()
}))
jest.mock("../../lib/server/get-relevant-memory", () => ({
  getRelevantMemoryForUser: jest.fn()
}))
jest.mock("../../lib/server/get-full-conversation", () => ({
  getFullConversationForUser: jest.fn(),
  NO_FULL_MATCH_MARKER: "no matching conversation found"
}))

const mockSummary = jest.mocked(getLatestSummaryForUser)
const mockRelevant = jest.mocked(getRelevantMemoryForUser)
const mockFull = jest.mocked(getFullConversationForUser)

beforeEach(() => {
  jest.clearAllMocks()
  mockSummary.mockResolvedValue("[LESSONS]\n- a\n[/LESSONS]")
  mockRelevant.mockResolvedValue(null)
  mockFull.mockResolvedValue(null)
})

it("injects nothing, and asks for nothing, when the window has no room", async () => {
  const memory = await memoryBlockFor("user-1", "hello", {
    windowTokens: 2_048
  })

  expect(memory.block).toBeNull()
  expect(memory.report.injected).toBe(false)
  expect(mockSummary).not.toHaveBeenCalled()
  expect(mockRelevant).not.toHaveBeenCalled()
  expect(mockFull).not.toHaveBeenCalled()
})

it("injects as before when there is room", async () => {
  const memory = await memoryBlockFor("user-1", "hello", {
    windowTokens: 128_000
  })

  expect(memory.block).toContain("[LESSONS]")
  expect(memory.report.injected).toBe(true)
  expect(memory.report.totalChars).toBeLessThanOrEqual(
    memory.report.budgetChars
  )
})
