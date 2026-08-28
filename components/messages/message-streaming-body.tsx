import { useChatStream } from "@/context/chat-stream-context"
import { IconBolt, IconCircleFilled, IconFileText } from "@tabler/icons-react"
import { FC } from "react"
import { MessageMarkdown } from "./message-markdown"

interface MessageStreamingBodyProps {
  content: string
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
  content
}) => {
  const { isGenerating, firstTokenReceived, toolInUse } = useChatStream()

  if (firstTokenReceived || !isGenerating) {
    return <MessageMarkdown content={content} />
  }

  switch (toolInUse) {
    case "none":
      return <IconCircleFilled className="animate-pulse" size={20} />
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
