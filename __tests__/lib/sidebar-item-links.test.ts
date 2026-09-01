import {
  resolveSelection,
  resolveToggles,
  singularize,
  toggleInList
} from "../../lib/sidebar-item-links"

const item = (id: string) => ({ id })

describe("resolveToggles", () => {
  // The link pickers report what was clicked, not what should end up linked.
  // An id in both lists was clicked *off*.
  it("adds what was clicked on and removes what was clicked off", () => {
    const starting = [item("a"), item("b")]
    const toggled = [item("b"), item("c")]

    expect(resolveToggles(starting, toggled)).toEqual({
      toAdd: [item("c")],
      toRemove: [item("b")]
    })
  })

  it("changes nothing when nothing was clicked", () => {
    // Opening the sheet and saving must not rewrite the links.
    expect(resolveToggles([item("a"), item("b")], [])).toEqual({
      toAdd: [],
      toRemove: []
    })
  })

  it("leaves untouched links alone", () => {
    const { toRemove } = resolveToggles(
      [item("a"), item("b"), item("c")],
      [item("b")]
    )

    expect(toRemove).toEqual([item("b")])
  })
})

describe("resolveSelection", () => {
  // The workspace picker keeps a full list, so absence means removal. This is
  // the opposite reading of the same-shaped input, which is why the two are
  // separate functions rather than one with a flag.
  it("removes what is absent from the selection", () => {
    const starting = [item("a"), item("b")]
    const selected = [item("b"), item("c")]

    expect(resolveSelection(starting, selected)).toEqual({
      toAdd: [item("c")],
      toRemove: [item("a")]
    })
  })

  it("treats an empty selection as removing everything", () => {
    expect(resolveSelection([item("a"), item("b")], [])).toEqual({
      toAdd: [],
      toRemove: [item("a"), item("b")]
    })
  })

  it("changes nothing when the selection is unchanged", () => {
    const starting = [item("a"), item("b")]

    expect(resolveSelection(starting, [...starting])).toEqual({
      toAdd: [],
      toRemove: []
    })
  })
})

describe("the two readings disagree, which is the point", () => {
  it("resolves the same input differently", () => {
    const starting = [item("a"), item("b")]
    const second = [item("b")]

    // Clicked: b goes. Selected: b stays and a goes.
    expect(resolveToggles(starting, second).toRemove).toEqual([item("b")])
    expect(resolveSelection(starting, second).toRemove).toEqual([item("a")])
  })
})

describe("toggleInList", () => {
  it("adds what is missing and drops what is there", () => {
    expect(toggleInList([item("a")], item("b"))).toEqual([item("a"), item("b")])
    expect(toggleInList([item("a"), item("b")], item("a"))).toEqual([item("b")])
  })

  it("matches on id rather than identity", () => {
    expect(toggleInList([{ id: "a", name: "first" }], { id: "a" })).toEqual([])
  })
})

describe("singularize", () => {
  it("trims the plural every content type uses", () => {
    expect(singularize("collections")).toBe("collection")
    expect(singularize("assistants")).toBe("assistant")
    expect(singularize("files")).toBe("file")
  })

  it("leaves a word that is already singular alone", () => {
    expect(singularize("model")).toBe("model")
  })
})
