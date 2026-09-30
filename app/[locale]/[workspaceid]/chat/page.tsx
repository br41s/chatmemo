"use client"

import { ChatHelp } from "@/components/chat/chat-help"
import { useChatHandler } from "@/components/chat/chat-hooks/use-chat-handler"
import { ChatInput } from "@/components/chat/chat-input"
import { CHAT_COMPOSER_CONTAINER } from "@/components/chat/chat-layout"
import { ChatSettings } from "@/components/chat/chat-settings"
import { ChatUI } from "@/components/chat/chat-ui"
import { QuickSettings } from "@/components/chat/quick-settings"
import { ChatEmptyState } from "@/components/chat/chat-empty-state"
import { useChatStream } from "@/context/chat-stream-context"
import { useChatInput } from "@/context/chat-input-context"
import useHotkey from "@/lib/hooks/use-hotkey"
import { useContext } from "react"

export default function ChatPage() {
  useHotkey("o", () => handleNewChat())
  useHotkey("l", () => {
    handleFocusChatInput()
  })

  const { chatMessages } = useChatStream()

  const { setUserInput } = useChatInput()

  const { handleNewChat, handleFocusChatInput } = useChatHandler()

  return (
    <>
      {chatMessages.length === 0 ? (
        <div className="relative flex h-full flex-col items-center justify-center">
          {/* Spanning the column rather than hanging off its midpoint: an absolute
              box at left-1/2 can only grow to half the column, which wrapped the
              tagline and the counts long before they ran out of room. */}
          <div className="absolute inset-x-0 top-1/2 mb-20 flex -translate-y-1/2 justify-center px-4">
            <ChatEmptyState onSuggestion={setUserInput} />
          </div>

          <div className="absolute left-2 top-2">
            <QuickSettings />
          </div>

          <div className="absolute right-2 top-2">
            <ChatSettings />
          </div>

          <div className="flex grow flex-col items-center justify-center" />

          <div className={CHAT_COMPOSER_CONTAINER}>
            <ChatInput />
          </div>

          <div className="absolute bottom-2 right-2 hidden md:block lg:bottom-4 lg:right-4">
            <ChatHelp />
          </div>
        </div>
      ) : (
        <ChatUI />
      )}
    </>
  )
}
