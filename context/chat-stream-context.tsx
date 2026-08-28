"use client"

import { ChatMessage } from "@/types"
import {
  Dispatch,
  FC,
  ReactNode,
  SetStateAction,
  createContext,
  useContext,
  useState
} from "react"

// The state that moves while a reply is streaming.
//
// It used to sit in the one ~60-value context with everything else, so every
// token re-rendered every consumer of that context: every message, every
// sidebar row, the switcher, the settings panels. `chat-input.tsx` carried a
// local mirror of the composer's value with the comment "avoids re-rendering
// 53+ context consumers on every keystroke" — a workaround for one symptom of
// the same problem.
//
// This is a provider rather than a memoised slice on purpose. Memoising the
// big value would need a fifty-entry dependency array and would still re-run
// on every token; putting the hot state in a child provider means the outer
// provider simply does not re-render when it changes, and `children` keeps its
// element identity so React skips the subtree that does not read this context.

interface ChatStreamContextValue {
  /** The transcript. Replaced on every token of the reply being written. */
  chatMessages: ChatMessage[]
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>
  isGenerating: boolean
  setIsGenerating: Dispatch<SetStateAction<boolean>>
  firstTokenReceived: boolean
  setFirstTokenReceived: Dispatch<SetStateAction<boolean>>
  abortController: AbortController | null
  setAbortController: Dispatch<SetStateAction<AbortController | null>>
  toolInUse: string
  setToolInUse: Dispatch<SetStateAction<string>>
}

export const ChatStreamContext = createContext<ChatStreamContextValue>({
  chatMessages: [],
  setChatMessages: () => {},
  isGenerating: false,
  setIsGenerating: () => {},
  firstTokenReceived: false,
  setFirstTokenReceived: () => {},
  abortController: null,
  setAbortController: () => {},
  toolInUse: "none",
  setToolInUse: () => {}
})

export const ChatStreamProvider: FC<{ children: ReactNode }> = ({
  children
}) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [firstTokenReceived, setFirstTokenReceived] = useState(false)
  const [abortController, setAbortController] =
    useState<AbortController | null>(null)
  const [toolInUse, setToolInUse] = useState("none")

  return (
    <ChatStreamContext.Provider
      value={{
        chatMessages,
        setChatMessages,
        isGenerating,
        setIsGenerating,
        firstTokenReceived,
        setFirstTokenReceived,
        abortController,
        setAbortController,
        toolInUse,
        setToolInUse
      }}
    >
      {children}
    </ChatStreamContext.Provider>
  )
}

export const useChatStream = () => useContext(ChatStreamContext)
