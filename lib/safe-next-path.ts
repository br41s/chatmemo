/**
 * The `next` parameter of the auth callback as a path on this site, or `/`.
 *
 * Decided on the resolved URL, not on string prefixes: `//host`, `/\host`,
 * `@host` and `/\t/host` all read as another host once a browser parses
 * them. Whatever `next` resolves to must keep the site's own origin; what
 * comes back is that URL's path, query and fragment.
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string
): string {
  if (!next) return "/"
  let url: URL
  try {
    url = new URL(next, origin)
  } catch {
    return "/"
  }
  if (url.origin !== origin) return "/"
  const path = `${url.pathname}${url.search}${url.hash}`
  // The path is resolved once more by whoever redirects to it. A pathname
  // that normalised to `//host` (`/a/..//host`) would then read as another
  // host, so the result must itself resolve back to this origin.
  if (new URL(path, origin).origin !== origin) return "/"
  return path
}
