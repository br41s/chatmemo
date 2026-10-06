import { safeNextPath } from "@/lib/safe-next-path"

const ORIGIN = "https://chatmemo.example"

describe("safeNextPath", () => {
  it("keeps a path on this site, query and fragment included", () => {
    expect(safeNextPath("/login/password", ORIGIN)).toBe("/login/password")
    expect(safeNextPath("/ws/chat?x=1#y", ORIGIN)).toBe("/ws/chat?x=1#y")
  })

  it("sends anything that resolves to another host home", () => {
    for (const next of [
      "//evil.example/login",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "https://chatmemo.example@evil.example/",
      // Normalise to a pathname starting with `//`, which re-resolves to
      // another host when the redirect is built from the returned path.
      "/foo/..//evil.example",
      "/..//evil.example/x",
      "https://chatmemo.example//evil.example"
    ]) {
      expect(safeNextPath(next, ORIGIN)).toBe("/")
    }
  })

  it("never leaves this origin, whatever the value looks like", () => {
    // These used to become another host when appended to the origin as a
    // string; resolved as URLs they are paths on this site.
    for (const next of [
      "@evil.example/login",
      ".evil.example",
      "evil.example"
    ]) {
      const path = safeNextPath(next, ORIGIN)
      expect(path.startsWith("/")).toBe(true)
      expect(new URL(path, ORIGIN).origin).toBe(ORIGIN)
    }
  })

  it("accepts an absolute URL of this very origin", () => {
    expect(safeNextPath(`${ORIGIN}/login/password`, ORIGIN)).toBe(
      "/login/password"
    )
  })

  it("defaults to the root", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/")
    expect(safeNextPath(undefined, ORIGIN)).toBe("/")
    expect(safeNextPath("", ORIGIN)).toBe("/")
  })
})
