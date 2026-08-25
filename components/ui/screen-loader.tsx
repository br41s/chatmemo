import { ChatSkeleton } from "@/components/ui/skeletons"
import { FC } from "react"

interface ScreenLoaderProps {}

export const ScreenLoader: FC<ScreenLoaderProps> = () => {
  return <ChatSkeleton />
}
