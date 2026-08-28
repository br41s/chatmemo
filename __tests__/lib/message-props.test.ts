import {
  ComparableMessageProps,
  messagePropsEqual,
  sameFileItems
} from "../../lib/message-props"

const fileItem = (id: string) => ({ id }) as any

const baseProps = (): ComparableMessageProps => ({
  message: { id: "m1", content: "hello" } as any,
  fileItems: [fileItem("f1")],
  isEditing: false,
  isLast: false,
  isGenerating: false,
  onStartEdit: () => {},
  onCancelEdit: () => {},
  onSubmitEdit: () => {},
  onRegenerate: () => {}
})

describe("sameFileItems", () => {
  it("accepts a rebuilt array holding the same rows", () => {
    // The case that matters: the parent filters the shared list afresh on every
    // render, so identity is never equal even when nothing changed.
    expect(sameFileItems([fileItem("a")], [fileItem("a")])).toBe(true)
  })

  it("rejects a different row, a different order, and a different length", () => {
    expect(sameFileItems([fileItem("a")], [fileItem("b")])).toBe(false)
    expect(
      sameFileItems(
        [fileItem("a"), fileItem("b")],
        [fileItem("b"), fileItem("a")]
      )
    ).toBe(false)
    expect(sameFileItems([fileItem("a")], [])).toBe(false)
  })

  it("short-circuits on identity", () => {
    const items = [fileItem("a")]
    expect(sameFileItems(items, items)).toBe(true)
  })
})

describe("messagePropsEqual", () => {
  it("holds a message still when only its file-item array is rebuilt", () => {
    const previous = baseProps()
    const next = { ...previous, fileItems: [fileItem("f1")] }

    expect(messagePropsEqual(previous, next)).toBe(true)
  })

  it("re-renders the message whose content just changed", () => {
    // What a token does: processResponse replaces exactly this one entry.
    const previous = baseProps()
    const next = {
      ...previous,
      message: { id: "m1", content: "hello t" } as any
    }

    expect(messagePropsEqual(previous, next)).toBe(false)
  })

  it("re-renders when generation starts or stops", () => {
    const previous = baseProps()

    expect(
      messagePropsEqual(previous, { ...previous, isGenerating: true })
    ).toBe(false)
  })

  it("re-renders when it becomes the last message, or goes into edit", () => {
    const previous = baseProps()

    expect(messagePropsEqual(previous, { ...previous, isLast: true })).toBe(
      false
    )
    expect(messagePropsEqual(previous, { ...previous, isEditing: true })).toBe(
      false
    )
  })

  it("re-renders on a fresh callback, which is why the parent stabilises them", () => {
    // If ChatMessages closed over the transcript instead of a ref, every
    // callback would be new on every token and the memo would never hold.
    const previous = baseProps()

    expect(
      messagePropsEqual(previous, { ...previous, onRegenerate: () => {} })
    ).toBe(false)
    expect(
      messagePropsEqual(previous, { ...previous, onSubmitEdit: () => {} })
    ).toBe(false)
  })
})
