import { ChatSkeleton } from "@/components/ui/skeletons"

// The workspace load is several round-trips, so this is on screen long enough
// to be worth shaping like the thing it is waiting for rather than spinning.
export default function Loading() {
  return <ChatSkeleton />
}
