import {
  assertSafeToolUrl,
  buildPinnedToolRequestOptions,
  buildSafeToolUrl,
  isBlockedToolAddress,
  resolvePublicToolAddress,
  safeToolRequest,
  sanitizeToolHeaders
} from "@/lib/server/safe-tool-request"

describe("safe tool requests", () => {
  describe("URL validation", () => {
    it.each([
      "http://api.example.com/data",
      "https://user:password@api.example.com/data",
      "https://localhost/data",
      "https://service/data",
      "https://metadata.google.internal/data"
    ])("rejects unsafe URL %s", url => {
      expect(() => assertSafeToolUrl(url)).toThrow()
    })

    it("preserves a server base path without allowing a protocol-relative path", () => {
      expect(
        buildSafeToolUrl(
          "https://api.example.com/v1/",
          "/weather",
          new URLSearchParams({ city: "A Coruña" })
        ).toString()
      ).toBe("https://api.example.com/v1/weather?city=A+Coru%C3%B1a")

      expect(() =>
        buildSafeToolUrl("https://api.example.com", "//evil.example/path")
      ).toThrow()

      expect(() =>
        buildSafeToolUrl("https://api.example.com/v1", "/users/../admin")
      ).toThrow("Tool path is invalid")
    })
  })

  describe("address validation", () => {
    it.each([
      ["127.0.0.1", 4],
      ["10.1.2.3", 4],
      ["169.254.169.254", 4],
      ["192.168.1.2", 4],
      ["::1", 6],
      ["::7f00:1", 6],
      ["::a00:1", 6],
      ["::ffff:10.1.2.3", 6],
      ["fc00::1", 6],
      ["fec0::1", 6],
      ["fe80::1", 6],
      ["2001:2::1", 6],
      ["2001:10::1", 6],
      ["2001:20::1", 6],
      ["3fff::1", 6]
    ])("blocks non-public address %s", (address, family) => {
      expect(isBlockedToolAddress(address, family)).toBe(true)
    })

    it("rejects a hostname if any DNS answer is non-public", async () => {
      await expect(
        resolvePublicToolAddress(
          new URL("https://api.example.com"),
          async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.2", family: 4 }
          ]
        )
      ).rejects.toThrow("non-public address")
    })

    it("returns a public address for pinning", async () => {
      await expect(
        resolvePublicToolAddress(
          new URL("https://api.example.com"),
          async () => [{ address: "8.8.8.8", family: 4 }]
        )
      ).resolves.toEqual({ address: "8.8.8.8", family: 4 })
    })

    it("rejects malformed addresses and mismatched DNS families", async () => {
      expect(isBlockedToolAddress("not-an-ip", 4)).toBe(true)
      expect(isBlockedToolAddress("127.0.0.1", 6)).toBe(true)

      await expect(
        resolvePublicToolAddress(
          new URL("https://api.example.com"),
          async () => [{ address: "8.8.8.8", family: 6 }]
        )
      ).rejects.toThrow("non-public address")
    })
  })

  describe("header validation", () => {
    it("allows API credentials owned by the tool", () => {
      expect(
        sanitizeToolHeaders({
          Authorization: "Bearer tool-token",
          "X-API-Key": "secret"
        })
      ).toEqual({
        Authorization: "Bearer tool-token",
        "X-API-Key": "secret"
      })
    })

    it.each([
      { Host: "internal" },
      { "X-Forwarded-Host": "internal" },
      { Cookie: "session=secret" },
      { "X-API-Key": "valid\r\nHost: internal" }
    ])("rejects routing or malformed headers", headers => {
      expect(() => sanitizeToolHeaders(headers)).toThrow()
    })
  })

  describe("request execution", () => {
    const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }]

    it("pins a fresh HTTPS connection to the validated address", () => {
      const callback = jest.fn()
      const options = buildPinnedToolRequestOptions(
        { method: "GET", headers: {} },
        { address: "8.8.8.8", family: 4 }
      )

      ;(options.lookup as any)("attacker-controlled", { all: false }, callback)

      expect(options.agent).toBe(false)
      expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4)
    })

    it("passes the validated DNS address to the HTTPS transport", async () => {
      const transport = jest.fn(async () => ({
        status: 200,
        statusText: "OK",
        headers: {},
        body: JSON.stringify({ ok: true })
      }))

      await expect(
        safeToolRequest(
          "https://api.example.com/data",
          { method: "GET" },
          { lookup: publicLookup, transport }
        )
      ).resolves.toEqual({ ok: true })

      expect(transport).toHaveBeenCalledWith(
        new URL("https://api.example.com/data"),
        { method: "GET", headers: {} },
        { address: "8.8.8.8", family: 4 },
        expect.any(Number)
      )
    })

    it("sanitizes headers even when the caller skips explicit validation", async () => {
      const transport = jest.fn()

      await expect(
        safeToolRequest(
          "https://api.example.com/data",
          { method: "GET", headers: { Host: "127.0.0.1" } },
          { lookup: publicLookup, transport }
        )
      ).rejects.toThrow("not allowed")

      expect(transport).not.toHaveBeenCalled()
    })

    it("rejects cross-origin redirects before forwarding tool headers", async () => {
      const transport = jest.fn(async () => ({
        status: 302,
        statusText: "Found",
        headers: { location: "https://evil.example/collect" },
        body: ""
      }))

      await expect(
        safeToolRequest(
          "https://api.example.com/data",
          {
            method: "GET",
            headers: { Authorization: "Bearer tool-token" }
          },
          { lookup: publicLookup, transport }
        )
      ).rejects.toThrow("cannot change origin")

      expect(transport).toHaveBeenCalledTimes(1)
    })

    it("revalidates DNS before a same-origin redirect", async () => {
      const lookup = jest
        .fn()
        .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
        .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      const transport = jest.fn(async () => ({
        status: 302,
        statusText: "Found",
        headers: { location: "/redirected" },
        body: ""
      }))

      await expect(
        safeToolRequest(
          "https://api.example.com/data",
          { method: "GET" },
          { lookup, transport }
        )
      ).rejects.toThrow("non-public address")

      expect(transport).toHaveBeenCalledTimes(1)
    })

    it("applies the total request deadline while DNS is pending", async () => {
      jest.useFakeTimers()

      try {
        const request = safeToolRequest(
          "https://api.example.com/data",
          { method: "GET", timeoutMs: 100 },
          { lookup: async () => new Promise(() => undefined) }
        )
        const rejection = expect(request).rejects.toMatchObject({ status: 504 })

        await jest.advanceTimersByTimeAsync(100)
        await rejection
      } finally {
        jest.useRealTimers()
      }
    })

    it("stops before transport when cancelled during DNS lookup", async () => {
      const controller = new AbortController()
      const transport = jest.fn()
      const pending = safeToolRequest(
        "https://api.example.com/data",
        { method: "GET", signal: controller.signal },
        {
          lookup: async () => new Promise<never>(() => undefined),
          transport
        }
      )

      controller.abort()

      await expect(pending).rejects.toMatchObject({ status: 499 })
      expect(transport).not.toHaveBeenCalled()
    })
  })
})
