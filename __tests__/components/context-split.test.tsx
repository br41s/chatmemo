/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react"
import { useContext, useRef } from "react"
import {
  ChatInputContext,
  ChatInputProvider,
  useChatInput
} from "../../context/chat-input-context"
import {
  ChatStreamProvider,
  useChatStream
} from "../../context/chat-stream-context"
import { ChatbotUIContext } from "../../context/context"

// The claim this file defends: a token of a streaming reply, or a keystroke in
// the composer, must not re-render the parts of the app that read neither.
// Before the split all three lived in one context, so both re-rendered every
// consumer of it — every message, every sidebar row, the switcher.

const renders = { cold: 0, stream: 0, input: 0 }

/** How many times this component has rendered. */
function useRenderCount() {
  const count = useRef(0)
  count.current += 1
  return count.current
}

function ColdConsumer() {
  useContext(ChatbotUIContext)
  renders.cold = useRenderCount()
  return null
}

function StreamConsumer() {
  const { chatMessages } = useChatStream()
  renders.stream = useRenderCount()
  return <span>{chatMessages.length}</span>
}

function InputConsumer() {
  const { userInput } = useChatInput()
  renders.input = useRenderCount()
  return <span>{userInput}</span>
}

type Setters = {
  stream: ReturnType<typeof useChatStream>
  input: ReturnType<typeof useChatInput>
}

function Capture({ into }: { into: Partial<Setters> }) {
  into.stream = useChatStream()
  into.input = useChatInput()
  return null
}

/** The same nesting GlobalState uses, without the data fetching. */
function Harness({ into }: { into: Partial<Setters> }) {
  return (
    <ChatbotUIContext.Provider value={{} as any}>
      <ChatStreamProvider>
        <ChatInputProvider>
          <ColdConsumer />
          <StreamConsumer />
          <InputConsumer />
          <Capture into={into} />
        </ChatInputProvider>
      </ChatStreamProvider>
    </ChatbotUIContext.Provider>
  )
}

describe("the split contexts", () => {
  it("keeps a token out of the cold context and the composer", () => {
    const captured: Partial<Setters> = {}
    render(<Harness into={captured} />)

    const before = { ...renders }

    act(() => {
      captured.stream!.setChatMessages([
        { message: { id: "a" }, fileItems: [] } as any
      ])
    })

    expect(renders.stream).toBe(before.stream + 1)
    expect(renders.cold).toBe(before.cold)
    expect(renders.input).toBe(before.input)
  })

  it("keeps a keystroke out of the cold context and the transcript", () => {
    const captured: Partial<Setters> = {}
    render(<Harness into={captured} />)

    const before = { ...renders }

    act(() => {
      captured.input!.setUserInput("h")
    })

    expect(renders.input).toBe(before.input + 1)
    expect(renders.cold).toBe(before.cold)
    expect(renders.stream).toBe(before.stream)
  })

  it("gives a consumer outside the provider working defaults", () => {
    // A component rendered outside the provider gets these; an unwired setter
    // would fail silently rather than throw, so it is worth asserting.
    let seen: ReturnType<typeof useChatInput> | undefined

    function Bare() {
      seen = useContext(ChatInputContext)
      return null
    }

    render(<Bare />)

    expect(seen?.userInput).toBe("")
    expect(seen?.isPromptPickerOpen).toBe(false)
    expect(typeof seen?.setUserInput).toBe("function")
  })
})
