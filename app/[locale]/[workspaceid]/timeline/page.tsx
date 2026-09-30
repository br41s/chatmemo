import { TimelineView } from "@/components/timeline/timeline-view"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Timeline"
}

export default function TimelinePage() {
  return <TimelineView />
}
