import {
  DRAWER_VIEWPORT,
  initialSidebarOpen,
  isDrawerViewport
} from "../../lib/sidebar-layout"

describe("initialSidebarOpen", () => {
  it("opens on a wide viewport when the preference says so", () => {
    expect(initialSidebarOpen(false, "true")).toBe(true)
  })

  it("stays closed on a wide viewport when the preference says so", () => {
    expect(initialSidebarOpen(false, "false")).toBe(false)
  })

  it("stays closed on a wide viewport when nothing is stored", () => {
    expect(initialSidebarOpen(false, null)).toBe(false)
  })

  it("ignores a stored preference on a narrow viewport", () => {
    // The whole point: a sidebar opened once on a laptop must not reopen as a
    // drawer over the conversation every time the same account loads on a
    // phone.
    expect(initialSidebarOpen(true, "true")).toBe(false)
  })

  it("treats anything that is not the literal 'true' as closed", () => {
    expect(initialSidebarOpen(false, "TRUE")).toBe(false)
    expect(initialSidebarOpen(false, "1")).toBe(false)
    expect(initialSidebarOpen(false, "")).toBe(false)
  })
})

describe("isDrawerViewport", () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    // jsdom ships no matchMedia, so the property is deleted rather than
    // restored to `undefined` when it was absent to begin with.
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia
    } else {
      delete (window as Partial<Window>).matchMedia
    }
  })

  const stubMatchMedia = (matches: boolean) => {
    const calls: string[] = []

    window.matchMedia = ((query: string) => {
      calls.push(query)
      return { matches } as MediaQueryList
    }) as typeof window.matchMedia

    return calls
  }

  it("reports a drawer when the query matches", () => {
    const calls = stubMatchMedia(true)

    expect(isDrawerViewport()).toBe(true)
    expect(calls).toEqual([DRAWER_VIEWPORT])
  })

  it("reports a column when the query does not match", () => {
    stubMatchMedia(false)

    expect(isDrawerViewport()).toBe(false)
  })

  it("reports a column where matchMedia is unavailable", () => {
    delete (window as Partial<Window>).matchMedia

    expect(isDrawerViewport()).toBe(false)
  })
})
