/**
 * The `next` parameter of the auth callback as a path on this site, or `/`.
 *
 * Only an absolute path qualifies: `//host` and `/\host` are read by browsers
 * as another host, and a bare `@host` or `.host` appended to the origin
 * changes the host too. Anything that is not a plain path goes home.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/"
  if (!next.startsWith("/")) return "/"
  if (next.startsWith("//") || next.startsWith("/\\")) return "/"
  return next
}
