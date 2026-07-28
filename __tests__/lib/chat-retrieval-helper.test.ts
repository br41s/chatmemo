/** @jest-environment node */

import { handleRetrieval } from "../../components/chat/chat-helpers"
import {
  MAX_RETRIEVAL_FILE_IDS,
  MAX_RETRIEVAL_QUERY_CHARS
} from "../../lib/retrieval/limits"
import { toast } from "sonner"

jest.mock("sonner", () => ({
  toast: { error: jest.fn() }
}))
jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: {}
}))

const FILE_ID = "123e4567-e89b-42d3-a456-426614174000"
const mockToastError = jest.mocked(toast.error)

function chatFile(id = FILE_ID) {
  return { id, name: "file.txt", type: "txt", file: {} as File }
}

describe("handleRetrieval", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns retrieval results", async () => {
    const results = [{ id: "item-id" }]
    const controller = new AbortController()
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )

    await expect(
      handleRetrieval(
        "question",
        [chatFile()],
        [],
        "local",
        4,
        controller.signal
      )
    ).resolves.toEqual(results)
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/retrieval/retrieve",
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it("surfaces JSON and non-JSON server errors", async () => {
    for (const [body, expected] of [
      [
        JSON.stringify({ message: "File is unavailable" }),
        "File is unavailable"
      ],
      ["upstream html", "File retrieval failed"]
    ]) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response(body, { status: 403 }))

      await expect(
        handleRetrieval("question", [chatFile()], [], "local", 4)
      ).rejects.toThrow(expected)
      expect(mockToastError).toHaveBeenLastCalledWith(expected)
    }
  })

  it("rejects client-side limits before sending a request", async () => {
    global.fetch = jest.fn()
    const files = Array.from(
      { length: MAX_RETRIEVAL_FILE_IDS + 1 },
      (_, index) => chatFile(`${index}`)
    )

    await expect(
      handleRetrieval("question", files, [], "local", 4)
    ).rejects.toThrow(`up to ${MAX_RETRIEVAL_FILE_IDS} files`)
    await expect(
      handleRetrieval(
        "x".repeat(MAX_RETRIEVAL_QUERY_CHARS + 1),
        [chatFile()],
        [],
        "local",
        4
      )
    ).rejects.toThrow(`at most ${MAX_RETRIEVAL_QUERY_CHARS} characters`)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
