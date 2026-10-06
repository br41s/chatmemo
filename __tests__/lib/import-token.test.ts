/**
 * @jest-environment node
 */
import {
  CLOUD_KEY_PREFIX,
  grantAllows,
  resolveImportToken
} from "@/lib/server/import-token"

const env = {
  CHATMEMO_IMPORT_USER_ID: "user-1",
  CHATMEMO_IMPORT_TOKEN: "general-token-0123456789",
  CHATMEMO_CLOUD_IMPORT_TOKEN: "cloud-token-0123456789"
}

describe("resolveImportToken", () => {
  it("is not involved without a bearer header", () => {
    expect(resolveImportToken(null, env)).toBeNull()
    expect(resolveImportToken("Basic abc", env)).toBeNull()
  })

  it("grants the general token any post for the owner", () => {
    expect(
      resolveImportToken(`Bearer ${env.CHATMEMO_IMPORT_TOKEN}`, env)
    ).toEqual({ userId: "user-1", keyPrefix: null })
  })

  it("limits the cloud token to Claude Code sessions", () => {
    expect(
      resolveImportToken(`Bearer ${env.CHATMEMO_CLOUD_IMPORT_TOKEN}`, env)
    ).toEqual({ userId: "user-1", keyPrefix: CLOUD_KEY_PREFIX })
  })

  it("rejects anything else, including a near miss", () => {
    expect(resolveImportToken("Bearer general-token-012345678", env)).toBe(
      "invalid"
    )
    expect(resolveImportToken("Bearer ", env)).toBe("invalid")
  })

  it("works with only one of the two tokens set", () => {
    const only = { ...env, CHATMEMO_CLOUD_IMPORT_TOKEN: undefined }
    expect(
      resolveImportToken(`Bearer ${env.CHATMEMO_IMPORT_TOKEN}`, only)
    ).toEqual({ userId: "user-1", keyPrefix: null })
    expect(
      resolveImportToken(`Bearer ${env.CHATMEMO_CLOUD_IMPORT_TOKEN}`, only)
    ).toBe("invalid")
  })

  it("reports an unconfigured server rather than guessing", () => {
    expect(resolveImportToken("Bearer x", { CHATMEMO_IMPORT_TOKEN: "x" })).toBe(
      "unconfigured"
    )
    expect(
      resolveImportToken("Bearer x", { CHATMEMO_IMPORT_USER_ID: "user-1" })
    ).toBe("unconfigured")
  })
})

describe("grantAllows", () => {
  it("lets a general grant post with or without a key", () => {
    const grant = { userId: "u", keyPrefix: null }
    expect(grantAllows(grant, null)).toBe(true)
    expect(grantAllows(grant, "anything")).toBe(true)
  })

  it("lets a cloud grant post only keyed Claude Code sessions", () => {
    const grant = { userId: "u", keyPrefix: CLOUD_KEY_PREFIX }
    expect(grantAllows(grant, "claude-code:abc")).toBe(true)
    expect(grantAllows(grant, null)).toBe(false)
    expect(grantAllows(grant, "copilot:abc")).toBe(false)
    expect(grantAllows(grant, "xclaude-code:abc")).toBe(false)
  })
})
