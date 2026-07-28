/** @jest-environment node */

import { consumeReadableStream } from "../../lib/consume-stream"

describe("consumeReadableStream", () => {
  it("propagates a provider stream failure", async () => {
    const failure = new Error("upstream failed")
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure)
      }
    })

    await expect(
      consumeReadableStream(stream, jest.fn(), new AbortController().signal)
    ).rejects.toBe(failure)
  })
})
