/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryBackupSection } from "../../components/memory/memory-backup-section"

// `lib/memory-backup-state.ts` is unit-tested: it encodes "export and restore
// never both run" and "a failure leaves nothing running but keeps the reason".
// Those are claims about a reducer. This file checks the component actually
// honours them — that the buttons are wired to the state the reducer produces,
// and that the export follows the route's pagination to the end instead of
// writing a backup that silently stops at page one.

const originalFetch = global.fetch
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

let downloads: { filename: string; content: string }[] = []

beforeEach(() => {
  downloads = []
  URL.createObjectURL = jest.fn(
    () => "blob:mock"
  ) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL

  // jsdom has no download behaviour, so record the anchor the component builds.
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push({ filename: this.download, content: "" })
  })
})

afterEach(() => {
  global.fetch = originalFetch
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  jest.restoreAllMocks()
})

const exportButton = () => screen.getByRole("button", { name: /Export/ })
const restoreButton = () => screen.getByRole("button", { name: /Restore/ })

describe("MemoryBackupSection export", () => {
  it("follows the route's pagination to the end", async () => {
    // The export route pages. Stopping at the first response would hand the
    // user a backup that looks complete and is not — the worst kind of
    // backup bug, because it is only discovered on restore.
    const pages = [
      {
        version: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        sources: { chatgpt: [{ content: "a", created_at: "x" }] },
        nextOffset: 100
      },
      {
        version: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        sources: { chatgpt: [{ content: "b", created_at: "y" }] },
        nextOffset: null
      }
    ]
    let call = 0
    const fetchMock = jest.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => pages[call++]
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    render(<MemoryBackupSection onRestored={jest.fn()} />)
    fireEvent.click(exportButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0][0]).toContain("offset=0")
    expect(fetchMock.mock.calls[1][0]).toContain("offset=100")

    // Both pages merged into one file for the source, not one file per page.
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(await screen.findByText(/2 (rows|memor)/i)).toBeTruthy()
  })

  it("writes one file per source", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        sources: {
          chatgpt: [{ content: "a", created_at: "x" }],
          claude: [{ content: "b", created_at: "y" }]
        },
        nextOffset: null
      })
    }) as unknown as typeof fetch

    render(<MemoryBackupSection onRestored={jest.fn()} />)
    fireEvent.click(exportButton())

    await waitFor(() => expect(downloads).toHaveLength(2))
    expect(downloads.map(d => d.filename).join(" ")).toMatch(/chatgpt/)
    expect(downloads.map(d => d.filename).join(" ")).toMatch(/claude/)
  })

  it("reports a failed export instead of a silent empty backup", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    }) as unknown as typeof fetch

    render(<MemoryBackupSection onRestored={jest.fn()} />)
    fireEvent.click(exportButton())

    expect(await screen.findByText(/HTTP 500/)).toBeTruthy()
    expect(downloads).toHaveLength(0)
  })

  it("re-enables both buttons after a failure", async () => {
    // "A failed export leaves nothing running but keeps the reason" — if the
    // component dropped the settled action, the panel would be dead until
    // reload.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    }) as unknown as typeof fetch

    render(<MemoryBackupSection onRestored={jest.fn()} />)
    fireEvent.click(exportButton())

    await screen.findByText(/HTTP 500/)
    expect(exportButton()).toHaveProperty("disabled", false)
    expect(restoreButton()).toHaveProperty("disabled", false)
  })

  it("locks restore while an export is running", async () => {
    // The reducer's invariant, checked where it matters: the two must never
    // both be in flight.
    let release: (value: unknown) => void = () => {}
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    ) as unknown as typeof fetch

    render(<MemoryBackupSection onRestored={jest.fn()} />)
    fireEvent.click(exportButton())

    await waitFor(() =>
      expect(restoreButton()).toHaveProperty("disabled", true)
    )
    expect(exportButton()).toHaveProperty("disabled", true)

    release({ ok: true, json: async () => ({ sources: {}, nextOffset: null }) })
    await waitFor(() =>
      expect(exportButton()).toHaveProperty("disabled", false)
    )
  })
})

describe("MemoryBackupSection restore", () => {
  const fileInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement

  const drop = (container: HTMLElement, text: string) => {
    const file = new File([text], "backup.json", { type: "application/json" })
    // jsdom's File has no usable .text() in this environment.
    Object.defineProperty(file, "text", { value: async () => text })
    fireEvent.change(fileInput(container), { target: { files: [file] } })
  }

  it("rejects a file that is not JSON without calling the server", async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { container } = render(<MemoryBackupSection onRestored={jest.fn()} />)
    drop(container, "this is not json")

    expect(await screen.findByText(/not valid JSON/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects JSON that is not a backup file", async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { container } = render(<MemoryBackupSection onRestored={jest.fn()} />)
    drop(container, JSON.stringify({ version: 1, source: "chatgpt" }))

    expect(await screen.findByText(/"rows" array/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends the rows and refreshes the panel on success", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, inserted: 3, skipped: 1 })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onRestored = jest.fn()

    const { container } = render(
      <MemoryBackupSection onRestored={onRestored} />
    )
    drop(container, JSON.stringify({ rows: [{ content: "a" }] }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      rows: [{ content: "a" }]
    })
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
  })

  it("does not refresh the panel when the restore failed", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, message: "Bad rows" })
    }) as unknown as typeof fetch
    const onRestored = jest.fn()

    const { container } = render(
      <MemoryBackupSection onRestored={onRestored} />
    )
    drop(container, JSON.stringify({ rows: [] }))

    expect(await screen.findByText("Bad rows")).toBeTruthy()
    expect(onRestored).not.toHaveBeenCalled()
  })
})
