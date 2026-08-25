import {
  IconCircleArrowDownFilled,
  IconCircleArrowUpFilled
} from "@tabler/icons-react"
import { FC } from "react"

interface ChatScrollButtonsProps {
  isAtTop: boolean
  isAtBottom: boolean
  isOverflowing: boolean
  scrollToTop: () => void
  scrollToBottom: () => void
}

// These were bare icons with an `onClick`, so they were unreachable by keyboard
// and unnamed to a screen reader. Same pixels, but now they are controls.
export const ChatScrollButtons: FC<ChatScrollButtonsProps> = ({
  isAtTop,
  isAtBottom,
  isOverflowing,
  scrollToTop,
  scrollToBottom
}) => {
  return (
    <>
      {!isAtTop && isOverflowing && (
        <button
          type="button"
          aria-label="Scroll to the start of the conversation"
          className="cursor-pointer rounded-full opacity-50 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={scrollToTop}
        >
          <IconCircleArrowUpFilled size={32} />
        </button>
      )}

      {!isAtBottom && isOverflowing && (
        <button
          type="button"
          aria-label="Scroll to the latest message"
          className="cursor-pointer rounded-full opacity-50 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={scrollToBottom}
        >
          <IconCircleArrowDownFilled size={32} />
        </button>
      )}
    </>
  )
}
