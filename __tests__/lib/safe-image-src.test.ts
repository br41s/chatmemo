import { isAllowedImageSrc } from "@/lib/safe-image-src"

const PAGE = "https://chatmemo.example"
const STORAGE = "https://abc.supabase.co"

describe("isAllowedImageSrc", () => {
  it("allows inline data, blobs and paths on this site", () => {
    expect(isAllowedImageSrc("data:image/png;base64,AAAA", PAGE, STORAGE)).toBe(
      true
    )
    expect(isAllowedImageSrc("blob:https://x/uuid", PAGE, STORAGE)).toBe(true)
    expect(isAllowedImageSrc("/_next/image?url=x", PAGE, STORAGE)).toBe(true)
  })

  it("allows the page origin and the storage project, nothing else", () => {
    expect(isAllowedImageSrc(`${PAGE}/logo.png`, PAGE, STORAGE)).toBe(true)
    expect(
      isAllowedImageSrc(
        `${STORAGE}/storage/v1/object/sign/a.png`,
        PAGE,
        STORAGE
      )
    ).toBe(true)
    expect(
      isAllowedImageSrc("https://evil.example/p?d=secret", PAGE, STORAGE)
    ).toBe(false)
    expect(
      isAllowedImageSrc("https://abc.supabase.co.evil.example/x", PAGE, STORAGE)
    ).toBe(false)
    expect(isAllowedImageSrc("http://abc.supabase.co/x", PAGE, STORAGE)).toBe(
      false
    )
  })

  it("rejects what only looks like a path or inline data", () => {
    expect(isAllowedImageSrc("//evil.example/x.png", PAGE, STORAGE)).toBe(false)
    expect(isAllowedImageSrc("/\\evil.example/x.png", PAGE, STORAGE)).toBe(
      false
    )
    expect(isAllowedImageSrc("data:text/html,<script>", PAGE, STORAGE)).toBe(
      false
    )
    expect(isAllowedImageSrc("javascript:alert(1)", PAGE, STORAGE)).toBe(false)
    expect(isAllowedImageSrc("", PAGE, STORAGE)).toBe(false)
    expect(isAllowedImageSrc(undefined, PAGE, STORAGE)).toBe(false)
  })

  it("without a page origin (server render) still allows storage and paths only", () => {
    expect(isAllowedImageSrc(`${STORAGE}/a.png`, undefined, STORAGE)).toBe(true)
    expect(isAllowedImageSrc("/a.png", undefined, STORAGE)).toBe(true)
    expect(isAllowedImageSrc(`${PAGE}/a.png`, undefined, STORAGE)).toBe(false)
    expect(isAllowedImageSrc(`${STORAGE}/a.png`, undefined, undefined)).toBe(
      false
    )
  })
})
