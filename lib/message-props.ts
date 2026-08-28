import { Tables } from "@/supabase/types"

/**
 * Whether two file-item lists name the same rows.
 *
 * `ChatMessages` recomputes each message's file items by filtering the shared
 * list, so the array is a new object on every render even when its contents are
 * identical — which would defeat the memo on every token of a streaming reply.
 * Comparing ids is what makes the memo hold.
 */
export function sameFileItems(
  a: Tables<"file_items">[],
  b: Tables<"file_items">[]
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false

  return a.every((item, index) => item.id === b[index].id)
}

/** The props a memoised message compares. Matches `MessageProps`. */
export interface ComparableMessageProps {
  message: Tables<"messages">
  fileItems: Tables<"file_items">[]
  isEditing: boolean
  isLast: boolean
  isGenerating: boolean
  onStartEdit: (message: Tables<"messages">) => void
  onCancelEdit: () => void
  onSubmitEdit: (value: string, sequenceNumber: number) => void
  onRegenerate: (content: string) => void
}

/**
 * Whether a message needs re-rendering.
 *
 * `processResponse` rebuilds only the streaming message on each token and
 * returns every other entry unchanged, so an identity check on `message` holds
 * the rest of the transcript still — provided every callback keeps its identity
 * too, which is why `ChatMessages` hands down `useCallback`s over a ref rather
 * than closures over the transcript.
 */
export function messagePropsEqual(
  previous: ComparableMessageProps,
  next: ComparableMessageProps
): boolean {
  return (
    previous.message === next.message &&
    previous.isEditing === next.isEditing &&
    previous.isLast === next.isLast &&
    previous.isGenerating === next.isGenerating &&
    previous.onStartEdit === next.onStartEdit &&
    previous.onCancelEdit === next.onCancelEdit &&
    previous.onSubmitEdit === next.onSubmitEdit &&
    previous.onRegenerate === next.onRegenerate &&
    sameFileItems(previous.fileItems, next.fileItems)
  )
}
