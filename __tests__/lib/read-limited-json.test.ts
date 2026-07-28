/** @jest-environment node */

import {
  LimitedJsonError,
  readLimitedFormData,
  readLimitedJson
} from "../../lib/server/read-limited-json"

function streamRequest(chunks: Uint8Array[]) {
  return new Request("http://localhost/test", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      }
    }),
    duplex: "half"
  } as RequestInit & { duplex: "half" })
}

describe("readLimitedJson", () => {
  it("rejects a missing body", async () => {
    await expect(
      readLimitedJson(new Request("http://localhost/test"), {
        maxBytes: 10,
        timeoutMs: 100
      })
    ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 400 })
  })

  it("rejects invalid and oversized Content-Length values", async () => {
    for (const value of ["invalid", "-1", "11"]) {
      const request = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Length": value },
        body: "{}"
      })

      await expect(
        readLimitedJson(request, { maxBytes: 10, timeoutMs: 100 })
      ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 413 })
    }
  })

  it("counts a chunked body and accepts exactly the byte limit", async () => {
    const encoded = new TextEncoder().encode('{"ok":true}')

    await expect(
      readLimitedJson(streamRequest([encoded]), {
        maxBytes: encoded.byteLength,
        timeoutMs: 100
      })
    ).resolves.toEqual({ ok: true })

    await expect(
      readLimitedJson(streamRequest([encoded, new Uint8Array([32])]), {
        maxBytes: encoded.byteLength,
        timeoutMs: 100
      })
    ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 413 })
  })

  it("rejects malformed JSON and invalid UTF-8", async () => {
    for (const body of [
      new TextEncoder().encode("{"),
      new Uint8Array([0xff])
    ]) {
      await expect(
        readLimitedJson(streamRequest([body]), {
          maxBytes: 10,
          timeoutMs: 100
        })
      ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 400 })
    }
  })

  it("cancels a body that does not complete before the deadline", async () => {
    jest.useFakeTimers()
    const cancel = jest.fn()
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half"
    } as RequestInit & { duplex: "half" })
    const result = readLimitedJson(request, {
      maxBytes: 10,
      timeoutMs: 50
    })
    const rejection = expect(result).rejects.toMatchObject<
      Partial<LimitedJsonError>
    >({ status: 408 })

    await jest.advanceTimersByTimeAsync(51)

    await rejection
    expect(cancel).toHaveBeenCalled()
    jest.useRealTimers()
  })

  it("parses bounded multipart form data", async () => {
    const form = new FormData()
    form.set("file_id", "file-id")
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: form
    })

    await expect(
      readLimitedFormData(request, { maxBytes: 1024, timeoutMs: 100 })
    ).resolves.toEqual(expect.any(FormData))
  })

  it("rejects non-multipart and oversized multipart bodies", async () => {
    await expect(
      readLimitedFormData(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }),
        { maxBytes: 1024, timeoutMs: 100 }
      )
    ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 400 })

    const form = new FormData()
    form.set("value", "x".repeat(1024))
    await expect(
      readLimitedFormData(
        new Request("http://localhost/test", { method: "POST", body: form }),
        { maxBytes: 32, timeoutMs: 100 }
      )
    ).rejects.toMatchObject<Partial<LimitedJsonError>>({ status: 413 })
  })
})
