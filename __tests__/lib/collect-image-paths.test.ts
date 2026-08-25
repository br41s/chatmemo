/**
 * Tests for collectImagePaths — pairing uploaded images with their storage
 * paths.
 *
 * The bug this replaces was silent: uploads were run over a FILTERED list
 * (images with no file skipped), failures were dropped from the results, and
 * what remained was re-zipped against the UNFILTERED list by index. One
 * skipped or failed upload shifted every later image onto another image's
 * path, so the wrong picture was attached to the message.
 */
import { collectImagePaths } from "../../components/chat/chat-helpers"

jest.mock("sonner", () => ({
  toast: { error: jest.fn() }
}))
jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: {}
}))

const img = (name: string) => ({ name, base64: `data:${name}`, file: null })

describe("collectImagePaths", () => {
  it("keeps each path with the image it came from", () => {
    const { images } = collectImagePaths(
      [
        { obj: img("a"), path: "p/a" },
        { obj: img("b"), path: "p/b" },
        { obj: img("c"), path: "p/c" }
      ],
      "msg-1"
    )

    expect(images.map(i => [i.name, i.path])).toEqual([
      ["a", "p/a"],
      ["b", "p/b"],
      ["c", "p/c"]
    ])
  })

  it("does not shift later images when one had nothing to upload", () => {
    // The exact misalignment: "b" has no file, so under the old zip "c" would
    // have taken b's index and been given p/a.
    const { images } = collectImagePaths(
      [
        { obj: img("a"), path: "p/a" },
        { obj: img("b"), path: null },
        { obj: img("c"), path: "p/c" }
      ],
      "msg-1"
    )

    expect(images.map(i => [i.name, i.path])).toEqual([
      ["a", "p/a"],
      ["b", ""],
      ["c", "p/c"]
    ])
  })

  it("does not shift later images when an upload failed", () => {
    const { images } = collectImagePaths(
      [
        { obj: img("a"), path: null },
        { obj: img("b"), path: "p/b" }
      ],
      "msg-1"
    )

    expect(images.map(i => [i.name, i.path])).toEqual([
      ["a", ""],
      ["b", "p/b"]
    ])
  })

  it("persists only the paths that exist", () => {
    // The message's image_paths must not carry blanks for images that never
    // reached storage.
    const { paths } = collectImagePaths(
      [
        { obj: img("a"), path: "p/a" },
        { obj: img("b"), path: null },
        { obj: img("c"), path: "p/c" }
      ],
      "msg-1"
    )

    expect(paths).toEqual(["p/a", "p/c"])
  })

  it("stamps every image with the message id", () => {
    const { images } = collectImagePaths(
      [{ obj: img("a"), path: "p/a" }],
      "msg-42"
    )
    expect(images[0].messageId).toBe("msg-42")
  })

  it("handles no images at all", () => {
    expect(collectImagePaths([], "msg-1")).toEqual({ paths: [], images: [] })
  })

  it("keeps the original image fields", () => {
    const { images } = collectImagePaths(
      [{ obj: img("a"), path: "p/a" }],
      "msg-1"
    )
    expect(images[0].base64).toBe("data:a")
  })
})
