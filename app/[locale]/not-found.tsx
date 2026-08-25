import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          That address does not lead anywhere. A chat or workspace it pointed at
          may have been deleted.
        </p>
      </div>

      <Button asChild>
        <Link href="/">Back to chat</Link>
      </Button>
    </div>
  )
}
