import { FC } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./tooltip"

interface WithTooltipProps {
  display: React.ReactNode
  trigger: React.ReactNode

  delayDuration?: number
  side?: "left" | "right" | "top" | "bottom"
  /**
   * The trigger is itself a control, or contains one. The tooltip then hangs
   * off a plain wrapper instead of a button: a button inside a button is
   * invalid HTML, which React reports as a hydration error, and it gave every
   * such control two tab stops — the wrapper, then the control.
   */
  interactive?: boolean
}

export const WithTooltip: FC<WithTooltipProps> = ({
  display,
  trigger,

  delayDuration = 500,
  side = "right",
  interactive = false
}) => {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        {interactive ? (
          <TooltipTrigger asChild>
            <span className="inline-flex items-center justify-center">
              {trigger}
            </span>
          </TooltipTrigger>
        ) : (
          <TooltipTrigger>{trigger}</TooltipTrigger>
        )}

        <TooltipContent side={side}>{display}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
