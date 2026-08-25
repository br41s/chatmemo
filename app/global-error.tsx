"use client"

import { useEffect } from "react"

/**
 * Last resort: an error thrown by the root layout itself, which the
 * locale-level boundary sits inside and so cannot catch.
 *
 * This replaces the document, so it has to render its own <html> and <body>
 * and cannot use the app's providers, fonts or theme tokens. Everything here
 * is deliberately self-contained and dependency-free — a boundary that throws
 * while rendering is worse than no boundary at all.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Fatal error:", error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#ffffff",
          color: "#14181f"
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>
          ChatMemo failed to start
        </h1>
        <p style={{ margin: 0, maxWidth: "32rem", color: "#59636f" }}>
          Your conversations and memory are stored in the database and are
          unaffected.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            border: "1px solid #14181f",
            background: "#14181f",
            color: "#ffffff",
            cursor: "pointer",
            font: "inherit"
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              color: "#8a94a0"
            }}
          >
            Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
