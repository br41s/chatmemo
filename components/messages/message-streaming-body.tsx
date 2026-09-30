import { useChatStream } from "@/context/chat-stream-context"
import type { MemoryReport } from "@/lib/memory-report"
import { IconBolt, IconCircleFilled, IconFileText } from "@tabler/icons-react"
import { FC } from "react"
import { MemoryRecalling } from "../memory/memory-recalling"
import { MessageMarkdown } from "./message-markdown"

interface MessageStreamingBodyProps {
  content: string
  /** The turn's memory report, which arrives before the first token. */
  report?: MemoryReport
}

/**
 * The body of the last assistant message while it is being written.
 *
 * This is the only component in the transcript that reads the stream context,
 * and it is rendered for exactly one message. Everything else — every earlier
 * message, every sidebar row, the switcher — used to re-render on every token
 * because the streaming state sat in the one context they all consume.
 */
export const MessageStreamingBody: FC<MessageStreamingBodyProps> = ({
  content,
  report
}) => {
  const { isGenerating, firstTokenReceived, toolInUse } = useChatStream()

  if (firstTokenReceived || !isGenerating) {
    return <MessageMarkdown content={content} />
  }

  switch (toolInUse) {
    case "none":
      // The wait before the first token is exactly when the memory was being
      // gathered, so that is what the wait shows — what is being remembered,
      // rather than a dot.
      return report?.injected ? (
        <MemoryRecalling report={report} />
      ) : (
        <IconCircleFilled className="animate-pulse" size={20} />
      )
    case "retrieval":
      return (
        <div className="flex animate-pulse items-center space-x-2">
          <IconFileText size={20} />

          <div>Searching files...</div>
        </div>
      )
    default:
      return (
        <div className="flex animate-pulse items-center space-x-2">
          <IconBolt size={20} />

          <div>Using {toolInUse}...</div>
        </div>
      )
  }
}
