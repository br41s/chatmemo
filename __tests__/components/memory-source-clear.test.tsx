/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemorySourceClear } from "../../components/memory/memory-source-clear"

// The claim this file defends: "delete everything I ever imported from
// ChatGPT" cannot happen on one click. UX-04 replaced a two-click toggle that
// disarmed itself on blur — so the second click could land on a button that
// had quietly gone back to being the first — with a real confirmation dialog.
// A regression here silently deletes user data, which is the worst failure
// this app has.

const originalFetch = global.fetch

function mockFetch(response: unknown, ok = true) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    json: async () => response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

afterEach(() => {
  global.fetch = originalFetch
  jest.clearAllMocks()
})

function renderClear(
  overrides: Partial<Parameters<typeof MemorySourceClear>[0]> = {}
) {
  const props = {
    disabled: false,
    onCleared: jest.fn(),
    onError: jest.fn(),
    ...overrides
  }
  render(<MemorySourceClear {...props} />)
  return props
}

describe("MemorySourceClear", () => {
  it("deletes nothing when the source button is clicked", async () => {
    const fetchMock = mockFetch({ success: true, deleted: 12 })
    const { onCleared } = renderClear()

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT/ }))

    // The dialog is up, and that is all that has happened.
    expect(
      await screen.findByText(/Delete everything imported from ChatGPT\?/)
    ).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it("deletes nothing when the dialog is dismissed", async () => {
    const fetchMock = mockFetch({ success: true, deleted: 12 })
    const { onCleared } = renderClear()

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it("deletes only once the destructive action is confirmed", async () => {
    const fetchMock = mockFetch({ success: true, deleted: 12 })
    const { onCleared } = renderClear()

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT/ }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete ChatGPT data" })
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/import/clear-source")
    expect(init.method).toBe("DELETE")
    expect(JSON.parse(init.body)).toEqual({ source: "chatgpt" })

    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
  })

  it("confirms the source the user actually picked", async () => {
    // Three buttons share one dialog, so the wrong one being sent is a real
    // shape of this bug: the user confirms "Claude" and loses ChatGPT.
    const fetchMock = mockFetch({ success: true, deleted: 3 })
    renderClear()

    fireEvent.click(screen.getByRole("button", { name: /Perplexity/ }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Perplexity data" })
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: "perplexity"
    })
  })

  it("reports how much was deleted", async () => {
    mockFetch({ success: true, deleted: 12 })
    renderClear()

    fireEvent.click(screen.getByRole("button", { name: /Claude/ }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Claude data" })
    )

    expect(await screen.findByText(/12/)).toBeTruthy()
  })

  it("reports a failure instead of claiming success", async () => {
    mockFetch({ success: false, reason: "nope" }, false)
    const { onCleared, onError } = renderClear()

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT/ }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete ChatGPT data" })
    )

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/chatgpt/i))
    // The parent must not refresh as though something had been removed.
    expect(onCleared).not.toHaveBeenCalled()
  })

  it("cannot be started while an import is running", async () => {
    // Clearing under a running import would race it.
    renderClear({ disabled: true })

    for (const label of ["ChatGPT", "Claude", "Perplexity"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) })
      ).toHaveProperty("disabled", true)
    }
  })
})
