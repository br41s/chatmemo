import dynamic from "next/dynamic"
import React, { FC } from "react"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { isAllowedImageSrc } from "@/lib/safe-image-src"
import { MessageMarkdownMemoized } from "./message-markdown-memoized"

// Lazy-load the syntax highlighter (~200KB Prism bundle) — only needed when a
// code block actually appears in a message, not on initial page load.
const MessageCodeBlock = dynamic(
  () =>
    import("./message-codeblock").then(m => ({ default: m.MessageCodeBlock })),
  { ssr: false }
)

interface MessageMarkdownProps {
  content: string
}

export const MessageMarkdown: FC<MessageMarkdownProps> = ({ content }) => {
  return (
    <MessageMarkdownMemoized
      className="prose min-w-full space-y-6 break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>
        },
        img({ node, ...props }) {
          // An image loads with no click, so one the model was talked into
          // emitting would carry whatever is in its URL to that host. Only
          // our own sources render; any other is shown as text.
          const pageOrigin =
            typeof window === "undefined" ? undefined : window.location.origin
          if (
            !isAllowedImageSrc(
              props.src,
              pageOrigin,
              process.env.NEXT_PUBLIC_SUPABASE_URL
            )
          ) {
            return (
              <span className="break-all text-sm text-muted-foreground">
                [image not loaded: {String(props.src ?? "")}]
              </span>
            )
          }
          return <img className="max-w-[67%]" alt="" {...props} />
        },
        code({ node, className, children, ...props }) {
          const childArray = React.Children.toArray(children)
          const firstChild = childArray[0] as React.ReactElement
          const firstChildAsString = React.isValidElement(firstChild)
            ? (firstChild as React.ReactElement<{ children?: React.ReactNode }>)
                .props.children
            : firstChild

          if (firstChildAsString === "▍") {
            return <span className="mt-1 animate-pulse cursor-default">▍</span>
          }

          if (typeof firstChildAsString === "string") {
            childArray[0] = firstChildAsString.replace("`▍`", "▍")
          }

          const match = /language-(\w+)/.exec(className || "")

          if (
            typeof firstChildAsString === "string" &&
            !firstChildAsString.includes("\n")
          ) {
            return (
              <code className={className} {...props}>
                {childArray}
              </code>
            )
          }

          return (
            <MessageCodeBlock
              key={Math.random()}
              language={(match && match[1]) || ""}
              value={String(childArray).replace(/\n$/, "")}
              {...props}
            />
          )
        }
      }}
    >
      {content}
    </MessageMarkdownMemoized>
  )
}
