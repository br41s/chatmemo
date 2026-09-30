/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { MessageStreamingBody } from "../../components/messages/message-streaming-body"
import { ChatStreamContext } from "../../context/chat-stream-context"
import type { MemoryReport, RecallPreview } from "../../lib/memory-report"

// The markdown renderer is ESM-only and irrelevant here: what matters is which
// of the states the body picks.
jest.mock("../../components/messages/message-markdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => (
    <div data-testid="answer">{content}</div>
  )
}))

// What this file defends: the wait before an answer says what is actually
// known at that moment, and stops saying it the moment the answer starts.

function renderBody(
  stream: {
    isGenerating?: boolean
    firstTokenReceived?: boolean
    recallPreview?: RecallPreview | null
  },
  report?: MemoryReport
) {
  const noop = () => {}
  return render(
    <ChatStreamContext.Provider
      value={{
        chatMessages: [],
        setChatMessages: noop,
        isGenerating: stream.isGenerating ?? true,
        setIsGenerating: noop,
        firstTokenReceived: stream.firstTokenReceived ?? false,
        setFirstTokenReceived: noop,
        abortController: null,
        setAbortController: noop,
        toolInUse: "none",
        setToolInUse: noop,
        recallPreview: stream.recallPreview ?? null,
        setRecallPreview: noop
      }}
    >
      <MessageStreamingBody content="the answer" report={report} />
    </ChatStreamContext.Provider>
  )
}

const preview: RecallPreview = {
  transcript: false,
  items: [
    { title: "Qatar refund", source: "chatgpt", date: "2026-08-02" },
    { title: "Viaje a Bangkok", source: "claude-ai" }
  ]
}

describe("MessageStreamingBody", () => {
  it("only says it is thinking when nothing is known yet", () => {
    renderBody({})
    expect(screen.getByText("Thinking…")).toBeTruthy()
    expect(screen.queryByText(/Remembering/)).toBeNull()
  })

  it("names the conversations once the preview arrives", () => {
    renderBody({ recallPreview: preview })
    expect(screen.getByText("Remembering 2 conversations")).toBeTruthy()
    expect(screen.getByText("Qatar refund")).toBeTruthy()
    expect(screen.getByText("Viaje a Bangkok")).toBeTruthy()
  })

  it("keeps thinking when the preview matched nothing", () => {
    renderBody({ recallPreview: { items: [], transcript: false } })
    expect(screen.getByText("Thinking…")).toBeTruthy()
  })

  it("says a conversation is being looked for on a recovery request", () => {
    renderBody({ recallPreview: { items: [], transcript: true } })
    expect(
      screen.getByText("Looking for the conversation you asked for")
    ).toBeTruthy()
  })

  it("prefers the turn's own report over the preview", () => {
    renderBody(
      { recallPreview: preview },
      {
        injected: true,
        totalChars: 10,
        budgetChars: 100,
        relevant: {
          chars: 10,
          entries: 1,
          items: [{ title: "Only this one", source: "perplexity" }]
        }
      }
    )
    expect(screen.getByText("Remembering 1 conversation")).toBeTruthy()
    expect(screen.queryByText("Qatar refund")).toBeNull()
  })

  it("drops the preview when the report says nothing was injected", () => {
    // The preview is a stand-in. A report that arrives empty — memory
    // retrieval failed for the turn — is the truth, and the chips must not
    // go on claiming otherwise until the first token.
    renderBody(
      { recallPreview: preview },
      { injected: false, totalChars: 0, budgetChars: 100 }
    )
    expect(screen.getByText("Thinking…")).toBeTruthy()
    expect(screen.queryByText(/Remembering/)).toBeNull()
  })

  it("says a transcript is being read only when the report found one", () => {
    renderBody(
      {},
      {
        injected: true,
        totalChars: 500,
        budgetChars: 1_000,
        fullConversation: { chars: 500 }
      }
    )
    expect(screen.getByText("Reading the recovered transcript")).toBeTruthy()
    expect(screen.queryByText(/Looking for/)).toBeNull()
  })

  it("gives way to the answer at the first token", () => {
    renderBody({ firstTokenReceived: true, recallPreview: preview })
    expect(screen.getByTestId("answer").textContent).toBe("the answer")
    expect(screen.queryByText(/Remembering/)).toBeNull()
  })
})
