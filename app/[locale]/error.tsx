"use client"

import { Button } from "@/components/ui/button"
import { useEffect } from "react"

/**
 * Recovery surface for anything thrown while rendering.
 *
 * There was no error boundary anywhere in the app, and the data layer throws
 * raw Postgres messages — 116 `throw new Error(error.message)` calls in `db/`,
 * all reached from client components. Any one of them replaced the whole app
 * with Next's default crash screen and offered no way back.
 *
 * The message itself is deliberately not shown. A database error string can
 * name tables, columns and constraints, which is neither useful to the person
 * reading it nor something to print on screen; it goes to the console instead,
 * where the digest ties it to the server log.
 */
export default function LocaleError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Unhandled error:", error)
  }, [error])

  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This part of ChatMemo failed to load. Your conversations and memory
          are unaffected.
        </p>
      </div>

      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.assign("/")}>
          Back to chat
        </Button>
      </div>

      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
    </div>
  )
}
