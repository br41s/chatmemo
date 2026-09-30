/**
 * @jest-environment node
 *
 * Tests for recallPreviewFor — what the browser is told a turn is about to be
 * reminded of, ahead of the answer.
 *
 * The preview is only worth showing if it is true of the turn, so it must
 * name exactly what the injector's relevance layer returns, and must not
 * pretend to know the outcome of a transcript search it did not run.
 */
import { recallPreviewFor } from "../../lib/server/inject-memory"
import { getFullConversationForUser } from "../../lib/server/get-full-conversation"
import { getRelevantMemoryForUser } from "../../lib/server/get-relevant-memory"

jest.mock("../../lib/server/get-latest-summary", () => ({
  getLatestSummaryForUser: jest.fn()
}))
jest.mock("../../lib/server/get-relevant-memory", () => ({
  getRelevantMemoryForUser: jest.fn()
}))
jest.mock("../../lib/server/get-full-conversation", () => ({
  getFullConversationForUser: jest.fn(),
  NO_FULL_MATCH_MARKER: "no matching conversation found",
  // The real detector: pure, and the thing under test depends on its verdict.
  detectFullConversationIntent: jest.requireActual(
    "../../lib/server/memory-terms"
  ).detectFullConversationIntent
}))

const mockRelevant = jest.mocked(getRelevantMemoryForUser)
const mockFull = jest.mocked(getFullConversationForUser)

beforeEach(() => jest.clearAllMocks())

describe("recallPreviewFor", () => {
  it("names the rows the relevance layer matched", async () => {
    mockRelevant.mockResolvedValue({
      block: "[RELEVANT MEMORY]…[/RELEVANT MEMORY]",
      entries: [
        "[source:chatgpt]\n### [2026-08-02] Qatar refund\n- QR832",
        "[source:claude]\n### [2026-09-01] Viaje a Bangkok\nPlan\n\n---\n\nmore"
      ]
    })

    const preview = await recallPreviewFor("user-1", "Qatar refund status", {
      windowTokens: 128_000
    })

    expect(preview).toEqual({
      transcript: false,
      items: [
        { title: "Qatar refund", source: "chatgpt", date: "2026-08-02" },
        { title: "Viaje a Bangkok", source: "claude-ai", date: "2026-09-01" }
      ]
    })
    expect(mockRelevant.mock.calls[0][0]).toBe("user-1")
    expect(mockRelevant.mock.calls[0][1]).toBe("Qatar refund status")
  })

  it("names nothing when nothing matched", async () => {
    mockRelevant.mockResolvedValue(null)
    expect(await recallPreviewFor("user-1", "hello there")).toEqual({
      items: [],
      transcript: false
    })
  })

  it("says a transcript is being looked for, without running that search twice", async () => {
    const preview = await recallPreviewFor(
      "user-1",
      "recover the full conversation about the Qatar refund"
    )

    expect(preview).toEqual({ items: [], transcript: true })
    // The injector runs the retrieval for the turn itself. The preview must
    // not repeat it, and must not name matches a transcript may replace.
    expect(mockFull).not.toHaveBeenCalled()
    expect(mockRelevant).not.toHaveBeenCalled()
  })

  it("shows nothing rather than failing when the search throws", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {})
    mockRelevant.mockRejectedValue(new Error("db down"))

    expect(await recallPreviewFor("user-1", "Qatar refund")).toEqual({
      items: [],
      transcript: false
    })
    quiet.mockRestore()
  })
})
