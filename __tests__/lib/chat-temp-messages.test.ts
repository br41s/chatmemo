/**
 * @jest-environment node
 *
 * Tests for createTempMessages — the optimistic pair inserted before a turn
 * streams.
 *
 * The regeneration path used to blank the last assistant message by writing to
 * it directly. That object is the one held in React state, so the write was a
 * mutation of rendered state, and spreading the outer array did not make it
 * safe: the message object inside was still the same reference.
 */
import { createTempMessages } from "../../components/chat/chat-helpers"

jest.mock("sonner", () => ({
  toast: { error: jest.fn() }
}))
jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: {}
}))
import type { ChatMessage, ChatSettings } from "../../types"

const settings = {
  model: "gpt-4o-mini",
  prompt: "be helpful",
  temperature: 0.5,
  contextLength: 4096,
  includeProfileContext: true,
  includeWorkspaceInstructions: true,
  embeddingsProvider: "openai"
} as unknown as ChatSettings

const message = (id: string, role: string, content: string): ChatMessage =>
  ({
    message: {
      chat_id: "chat-1",
      assistant_id: null,
      content,
      created_at: "",
      id,
      image_paths: [],
      model: "gpt-4o-mini",
      role,
      sequence_number: 0,
      updated_at: "",
      user_id: "user-1"
    },
    fileItems: []
  }) as unknown as ChatMessage

describe("createTempMessages — regeneration", () => {
  it("does not mutate the messages it was given", () => {
    const existing = [
      message("m1", "user", "what did I decide?"),
      message("m2", "assistant", "the original answer")
    ]

    createTempMessages(
      "what did I decide?",
      existing,
      settings,
      [],
      true,
      () => {},
      null
    )

    // The caller's array still holds the answer that was on screen. Without
    // this, a failed regeneration had nothing to restore.
    expect(existing[1].message.content).toBe("the original answer")
  })

  it("hands React a new object for the message it blanked", () => {
    const existing = [
      message("m1", "user", "hi"),
      message("m2", "assistant", "previous")
    ]
    let published: ChatMessage[] = []

    createTempMessages(
      "hi",
      existing,
      settings,
      [],
      true,
      (next: any) => {
        published = next
      },
      null
    )

    expect(published[1].message.content).toBe("")
    // A new object, so React sees a change rather than an identical reference.
    expect(published[1]).not.toBe(existing[1])
    expect(published[1].message).not.toBe(existing[1].message)
  })

  it("leaves earlier messages untouched by reference", () => {
    const existing = [
      message("m1", "user", "hi"),
      message("m2", "assistant", "previous")
    ]
    let published: ChatMessage[] = []

    createTempMessages(
      "hi",
      existing,
      settings,
      [],
      true,
      (next: any) => {
        published = next
      },
      null
    )

    expect(published[0]).toBe(existing[0])
  })
})

describe("createTempMessages — new turn", () => {
  it("appends an optimistic user and assistant pair", () => {
    const existing = [message("m1", "user", "earlier")]
    let published: ChatMessage[] = []

    const { tempUserChatMessage, tempAssistantChatMessage } =
      createTempMessages(
        "new question",
        existing,
        settings,
        [],
        false,
        (next: any) => {
          published = next
        },
        null
      )

    expect(published).toHaveLength(3)
    expect(published[1]).toBe(tempUserChatMessage)
    expect(published[2]).toBe(tempAssistantChatMessage)
    expect(published[1].message.content).toBe("new question")
    expect(published[2].message.content).toBe("")
  })
})
