import { useChatHandler } from "@/components/chat/chat-hooks/use-chat-handler"
import { useChatStream } from "@/context/chat-stream-context"
import { ChatbotUIContext } from "@/context/context"
import { Tables } from "@/supabase/types"
import { FC, useCallback, useContext, useRef, useState } from "react"
import { Message } from "../messages/message"

interface ChatMessagesProps {}

/**
 * The transcript.
 *
 * This is where the streaming state is read, and it is deliberately the only
 * place in the transcript that reads it (besides the one streaming message
 * body). Everything a `Message` needs arrives as a prop, and every callback is
 * stable, so `Message`'s memo holds for every message except the one being
 * written.
 */
export const ChatMessages: FC<ChatMessagesProps> = ({}) => {
  const { chatFileItems } = useContext(ChatbotUIContext)
  const { chatMessages, isGenerating, setIsGenerating } = useChatStream()

  const { handleSendEdit, handleSendMessage } = useChatHandler()

  const [editingMessage, setEditingMessage] = useState<Tables<"messages">>()

  // The callbacks below have to keep the same identity across a stream, but
  // they need the transcript and the handlers as they are at the moment of the
  // click. A ref refreshed on each render gives both.
  const latest = useRef({
    chatMessages,
    handleSendEdit,
    handleSendMessage,
    setIsGenerating
  })
  latest.current = {
    chatMessages,
    handleSendEdit,
    handleSendMessage,
    setIsGenerating
  }

  const cancelEdit = useCallback(() => setEditingMessage(undefined), [])

  const submitEdit = useCallback((value: string, sequenceNumber: number) => {
    latest.current.handleSendEdit(value, sequenceNumber)
  }, [])

  const regenerate = useCallback((content: string) => {
    const { chatMessages, handleSendMessage, setIsGenerating } = latest.current

    setIsGenerating(true)

    // Same fallback the message used to compute for itself: its own content if
    // it has any, otherwise the prompt that produced it.
    return handleSendMessage(
      content || chatMessages[chatMessages.length - 2].message.content,
      chatMessages,
      true
    )
  }, [])

  return chatMessages
    .slice()
    .sort((a, b) => a.message.sequence_number - b.message.sequence_number)
    .map((chatMessage, index, array) => {
      const messageFileItems = chatFileItems.filter(
        (chatFileItem, _, self) =>
          chatMessage.fileItems.includes(chatFileItem.id) &&
          self.findIndex(item => item.id === chatFileItem.id) === _
      )

      return (
        <Message
          key={chatMessage.message.sequence_number}
          message={chatMessage.message}
          fileItems={messageFileItems}
          isEditing={editingMessage?.id === chatMessage.message.id}
          isLast={index === array.length - 1}
          isGenerating={isGenerating}
          onStartEdit={setEditingMessage}
          onCancelEdit={cancelEdit}
          onSubmitEdit={submitEdit}
          onRegenerate={regenerate}
        />
      )
    })
}
