import { safeNextPath } from "@/lib/safe-next-path"

describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/login/password")).toBe("/login/password")
    expect(safeNextPath("/ws/chat?x=1#y")).toBe("/ws/chat?x=1#y")
  })

  it("sends anything that would change the host home", () => {
    for (const next of [
      "@evil.example/login",
      ".evil.example",
      "//evil.example/login",
      "/\\evil.example",
      "https://evil.example",
      "evil.example"
    ]) {
      expect(safeNextPath(next)).toBe("/")
    }
  })

  it("defaults to the root", () => {
    expect(safeNextPath(null)).toBe("/")
    expect(safeNextPath(undefined)).toBe("/")
    expect(safeNextPath("")).toBe("/")
  })
})
