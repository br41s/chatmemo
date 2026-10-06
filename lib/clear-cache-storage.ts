/**
 * Delete every Cache Storage entry this origin holds in the browser.
 *
 * The service worker no longer caches API or page responses, but a worker
 * installed before that change left `apis`, `pages` and `cross-origin`
 * caches behind, holding memory exports and a page payload with the user's
 * provider keys for up to a day. Sign-out is the moment a shared device
 * changes hands, so it empties them. Never throws: a browser without the API
 * (or a private window that refuses it) still signs out.
 */
export async function clearCacheStorage(): Promise<void> {
  try {
    if (typeof caches === "undefined") return
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
  } catch {
    // Nothing to do: the sign-out itself has already happened.
  }
}
