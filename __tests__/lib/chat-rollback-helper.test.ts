/** @jest-environment node */

import { rollbackFailedChatMessages } from "../../components/chat/chat-helpers"
import { ChatMessage } from "../../types"

jest.mock("sonner", () => ({
  toast: { error: jest.fn() }
}))
jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: {}
}))

function chatMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  sequenceNumber: number
): ChatMessage {
  return {
    message: {
      chat_id: "chat-id",
      assistant_id: null,
      content,
      created_at: "",
      id,
      image_paths: [],
      model: "gpt-4",
      role,
      sequence_number: sequenceNumber,
      updated_at: "",
      user_id: "user-id"
    },
    fileItems: []
  }
}

// The helper is called with React's setState dispatch, so exercise it the way
// React would: hand it the updater and apply it to the current list.
function applyRollback(
  messages: ChatMessage[],
  regenerationTarget: { id: string; content: string } | null
) {
  let result = messages
  rollbackFailedChatMessages(updater => {
    result =
      typeof updater === "function"
        ? (updater as (previous: ChatMessage[]) => ChatMessage[])(result)
        : updater
  }, regenerationTarget)

  return result
}

describe("rollbackFailedChatMessages", () => {
  it("drops the optimistic pair when a fresh send fails", () => {
    const messages = [
      chatMessage("a", "user", "first question", 0),
      chatMessage("b", "assistant", "first answer", 1),
      chatMessage("c", "user", "second question", 2),
      chatMessage("d", "assistant", "", 3)
    ]

    const result = applyRollback(messages, null)

    expect(result.map(entry => entry.message.id)).toEqual(["a", "b"])
  })

  it("restores the previous answer when a regeneration fails", () => {
    const blanked = chatMessage("b", "assistant", "", 1)
    const messages = [chatMessage("a", "user", "first question", 0), blanked]

    const result = applyRollback(messages, {
      id: "b",
      content: "first answer"
    })

    expect(result.map(entry => entry.message.id)).toEqual(["a", "b"])
    expect(result[1].message.content).toBe("first answer")
  })

  it("does not mutate the blanked message in place", () => {
    const blanked = chatMessage("b", "assistant", "", 1)
    const messages = [chatMessage("a", "user", "first question", 0), blanked]

    const result = applyRollback(messages, {
      id: "b",
      content: "first answer"
    })

    expect(blanked.message.content).toBe("")
    expect(result[1]).not.toBe(blanked)
  })

  it("leaves the user turn untouched when regenerating the only exchange", () => {
    const messages = [
      chatMessage("a", "user", "only question", 0),
      chatMessage("b", "assistant", "", 1)
    ]

    const result = applyRollback(messages, {
      id: "b",
      content: "only answer"
    })

    expect(result).toHaveLength(2)
    expect(result[0].message.content).toBe("only question")
  })
})
