"use client"

import { FC } from "react"
import { ChatMemoSVG } from "../icons/chatmemo-svg"

interface BrandProps {
  theme?: "dark" | "light"
}

// The mark is identity, not navigation. It used to be an external link to
// chatbotui.com — the fork's homepage — which made the most prominent element
// on the login and empty-chat screens send people to a different product.
export const Brand: FC<BrandProps> = ({ theme = "dark" }) => {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-2">
        <ChatMemoSVG theme={theme === "dark" ? "dark" : "light"} scale={0.3} />
      </div>

      <div className="text-4xl font-bold tracking-wide">ChatMemo</div>

      <div className="mt-1 text-sm text-muted-foreground">
        One memory across your AI conversations
      </div>
    </div>
  )
}
