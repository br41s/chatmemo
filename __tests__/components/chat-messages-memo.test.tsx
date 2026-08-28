/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react"
import { ChatMessages } from "../../components/chat/chat-messages"
import {
  ChatStreamProvider,
  useChatStream
} from "../../context/chat-stream-context"
import { ChatbotUIContext } from "../../context/context"

// Message pulls in markdown rendering, model icons and a Supabase-backed
// context. Substituting a counting stub behind the *real* comparator tests the
// thing that actually matters: that ChatMessages hands down props stable enough
// for the memo to hold while a reply streams in.
// `mock`-prefixed so jest lets the hoisted factory below close over it.
const mockRenderCounts: Record<string, number> = {}

jest.mock("../../components/messages/message", () => {
  const react = require("react")
  const { messagePropsEqual } = require("../../lib/message-props")

  const Stub = ({ message }: any) => {
    const seen = react.useRef(0)
    seen.current += 1
    mockRenderCounts[message.id] = seen.current
    return null
  }

  return { Message: react.memo(Stub, messagePropsEqual) }
})

jest.mock("../../components/chat/chat-hooks/use-chat-handler", () => ({
  useChatHandler: () => ({
    handleSendEdit: jest.fn(),
    handleSendMessage: jest.fn()
  })
}))

const chatMessage = (id: string, sequence: number, content: string) => ({
  message: { id, sequence_number: sequence, content, role: "assistant" },
  fileItems: []
})

type Stream = ReturnType<typeof useChatStream>

function Capture({ into }: { into: { stream?: Stream } }) {
  into.stream = useChatStream()
  return null
}

function Harness({ into }: { into: { stream?: Stream } }) {
  return (
    <ChatbotUIContext.Provider value={{ chatFileItems: [] } as any}>
      <ChatStreamProvider>
        <Capture into={into} />
        <ChatMessages />
      </ChatStreamProvider>
    </ChatbotUIContext.Provider>
  )
}

beforeEach(() => {
  for (const key of Object.keys(mockRenderCounts)) delete mockRenderCounts[key]
})

describe("ChatMessages", () => {
  it("re-renders only the message a token changed", () => {
    const captured: { stream?: Stream } = {}
    render(<Harness into={captured} />)

    const first = chatMessage("a", 0, "question")
    const second = chatMessage("b", 1, "")

    act(() => {
      captured.stream!.setChatMessages([first, second] as any)
    })

    const before = { ...mockRenderCounts }

    // A token: processResponse rebuilds the streaming entry and returns every
    // other entry unchanged.
    act(() => {
      captured.stream!.setChatMessages(previous =>
        previous.map(entry =>
          entry.message.id === "b"
            ? { ...entry, message: { ...entry.message, content: "he" } }
            : entry
        )
      )
    })

    expect(mockRenderCounts["b"]).toBe(before["b"] + 1)
    expect(mockRenderCounts["a"]).toBe(before["a"])
  })

  it("does not mutate the transcript while sorting it", () => {
    // It used to call .sort() straight on the state array.
    const captured: { stream?: Stream } = {}
    render(<Harness into={captured} />)

    const messages = [chatMessage("z", 2, "last"), chatMessage("y", 1, "first")]

    act(() => {
      captured.stream!.setChatMessages(messages as any)
    })

    expect(messages.map(entry => entry.message.id)).toEqual(["z", "y"])
  })
})
