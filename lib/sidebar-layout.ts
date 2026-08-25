// Where the sidebar stops being a column and starts being a drawer.
//
// It was a fixed 350px with no breakpoint at all, which on a 375px phone left
// roughly 25px of screen for the conversation the sidebar is meant to navigate.

/**
 * Below this width the sidebar floats over the conversation instead of sitting
 * beside it. The dashboard expresses the same split in `sm:` classes, so the
 * query is written against the number Tailwind uses for that breakpoint — the
 * two have to agree or the drawer and the column overlap.
 */
export const DRAWER_VIEWPORT = "(max-width: 639px)"

/** Whether the viewport is narrow enough that the sidebar is a drawer. */
export function isDrawerViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DRAWER_VIEWPORT).matches
  )
}

/**
 * Whether the sidebar starts open.
 *
 * The stored preference is a laptop preference. Honouring it on a phone would
 * open a full-height drawer over the conversation on every load, before the
 * person has asked for anything — so the narrow layout always starts closed and
 * the preference only decides the wide one.
 */
export function initialSidebarOpen(
  isDrawer: boolean,
  storedPreference: string | null
): boolean {
  if (isDrawer) return false

  return storedPreference === "true"
}
