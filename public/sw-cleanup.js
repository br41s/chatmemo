// Imported by the generated service worker (next.config.js, workboxOptions
// .importScripts). The worker no longer caches responses at runtime, but a
// worker installed before that change left its runtime caches behind: "apis"
// (memory exports, the timeline), "pages" / "pages-rsc" (the page payload,
// profile and provider keys included), "cross-origin" (Supabase responses).
// Nothing reads them any more, so their expiry never runs either. The new
// worker deletes every cache that is not its own precache when it activates.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => !key.startsWith("workbox-precache"))
            .map(key => caches.delete(key))
        )
      )
  )
})
