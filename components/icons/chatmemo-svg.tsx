import { FC } from "react"

interface ChatMemoSVGProps {
  /** Unused: the mark follows the text colour. Kept for existing callers. */
  theme?: "dark" | "light"
  scale?: number
}

/**
 * The ChatMemo mark: a speech bubble holding a memo.
 *
 * The bubble is the conversation, the lines are what was kept of it, and
 * the last line is in the brand colour — the piece that is remembered. It
 * replaces the fork's "UI" lettermark, which was the other product's logo.
 * Drawn in the current text colour so it follows the theme without a
 * palette of its own; `theme` stays in the signature for the callers that
 * pass it.
 */
export const ChatMemoSVG: FC<ChatMemoSVGProps> = ({ scale = 1 }) => {
  return (
    <svg
      width={189 * scale}
      height={194 * scale}
      viewBox="0 0 189 194"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="text-foreground"
    >
      <rect
        x="12.5"
        y="12.5"
        width="164"
        height="127"
        rx="37.5"
        stroke="currentColor"
        strokeWidth="18"
      />
      <path
        d="M72.7643 143.457C77.2953 143.443 79.508 148.98 76.2146 152.092L42.7738 183.69C39.5361 186.749 34.2157 184.366 34.3419 179.914L35.2341 148.422C35.3106 145.723 37.5158 143.572 40.2158 143.564L72.7643 143.457Z"
        fill="currentColor"
      />
      <rect x="52" y="50" width="86" height="12" rx="6" fill="currentColor" />
      <rect x="52" y="72" width="64" height="12" rx="6" fill="currentColor" />
      <rect
        x="52"
        y="94"
        width="44"
        height="12"
        rx="6"
        fill="hsl(var(--brand))"
      />
    </svg>
  )
}
