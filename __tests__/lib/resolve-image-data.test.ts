import { resolveImageData } from "../../lib/build-prompt"
import { MessageImage } from "../../types"

jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: { from: jest.fn() }
}))

jest.mock("../../lib/blob-to-b64", () => ({
  convertBlobToBase64: jest.fn(async () => "data:image/png;base64,ENCODED")
}))

const image = (overrides: Partial<MessageImage>): MessageImage => ({
  messageId: "m1",
  path: "user/img.png",
  base64: "",
  url: "",
  file: null,
  ...overrides
})

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({ blob: async () => "blob" })) as any
})

describe("resolveImageData", () => {
  it("passes a data URL straight through", async () => {
    expect(await resolveImageData("data:image/png;base64,AAA", [])).toBe(
      "data:image/png;base64,AAA"
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("uses the base64 when it has already been encoded", async () => {
    const images = [image({ base64: "data:image/png;base64,DONE" })]

    expect(await resolveImageData("user/img.png", images)).toBe(
      "data:image/png;base64,DONE"
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("encodes from the signed URL when the background pass has not finished", async () => {
    // The race this exists for: images now render from a signed URL and encode
    // behind the transcript, so a send in the first moment after opening a chat
    // can arrive before the base64 does. Anthropic reads the media type out of
    // a data URL, so a link will not do.
    const images = [image({ url: "https://signed/img.png" })]

    expect(await resolveImageData("user/img.png", images)).toBe(
      "data:image/png;base64,ENCODED"
    )
    expect(global.fetch).toHaveBeenCalledWith("https://signed/img.png")
  })

  it("caches what it encoded so a second message does not fetch again", async () => {
    const images = [image({ url: "https://signed/img.png" })]

    await resolveImageData("user/img.png", images)
    await resolveImageData("user/img.png", images)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(images[0].base64).toBe("data:image/png;base64,ENCODED")
  })

  it("returns empty for an image it has never heard of", async () => {
    expect(await resolveImageData("user/missing.png", [])).toBe("")
  })

  it("returns empty rather than throwing when the fetch fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network")
    }) as any

    const images = [image({ url: "https://signed/img.png" })]

    expect(await resolveImageData("user/img.png", images)).toBe("")
  })
})
