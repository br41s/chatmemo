import { Skeleton } from "@/components/ui/skeleton"
import { FC } from "react"

/**
 * Loading states that hold the shape of what is coming.
 *
 * These replaced a centred spinner and the string "Loading…". Both told the
 * person that something was happening and nothing about what, so the wait read
 * as a stall — which matters here because the workspace load is several
 * round-trips and the memory panel pages its rows.
 *
 * They are deliberately dumb: no props, no measurement, no shimmer beyond the
 * one animation the Skeleton primitive already has. The only requirement is
 * that the blocks land roughly where the real content lands, so the page does
 * not jump when it arrives.
 */

/** The chat pane: title bar, a few exchanges, the composer. */
export const ChatSkeleton: FC = () => (
  <div
    className="flex size-full flex-col items-center"
    role="status"
    aria-label="Loading the conversation"
  >
    <div className="flex max-h-[50px] min-h-[50px] w-full items-center justify-center border-b-2 bg-secondary">
      <Skeleton className="h-4 w-40" />
    </div>

    <div className="flex w-full flex-1 flex-col overflow-hidden">
      {[0, 1, 2].map(index => (
        <div
          key={index}
          className={`flex w-full justify-center ${
            index % 2 === 0 ? "" : "bg-secondary"
          }`}
        >
          <div className="w-full space-y-3 p-6 sm:w-[550px] sm:px-0 md:w-[650px] xl:w-[700px]">
            <div className="flex items-center space-x-3">
              <Skeleton className="size-8 rounded" />
              <Skeleton className="h-4 w-28" />
            </div>

            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            {index % 2 === 1 && <Skeleton className="h-3.5 w-3/4" />}
          </div>
        </div>
      ))}
    </div>

    <div className="w-full min-w-[300px] px-2 pb-3 pt-0 sm:w-[600px] sm:pb-8 sm:pt-5 md:w-[700px] xl:w-[800px]">
      <Skeleton className="h-[60px] w-full rounded-xl" />
    </div>
  </div>
)

/** A list of memory or timeline rows. */
export const RowListSkeleton: FC<{ rows?: number; label?: string }> = ({
  rows = 5,
  label = "Loading"
}) => (
  <div className="flex flex-1 flex-col gap-2" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    ))}
  </div>
)
