/**
 * @jest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react"
import { useContext } from "react"
import { ChatbotUIContext } from "../../context/context"
import { GlobalState } from "../../components/utility/global-state"

// The claim this file defends: the profile and the workspace list are present
// on the very first render, and nothing goes to the network to get them.
//
// They used to be the head of one serial chain — session, profile, workspaces,
// then one signed URL per workspace image in a loop, then the model
// catalogues. Every surface that reads the profile waited for the first two
// hops, with no spinner to explain it.

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

const getWorkspaceImageFromStorage = jest.fn()
jest.mock("../../db/storage/workspace-images", () => ({
  getWorkspaceImageFromStorage: (path: string) =>
    getWorkspaceImageFromStorage(path)
}))

const fetchHostedModels = jest.fn()
jest.mock("../../lib/models/fetch-models", () => ({
  fetchHostedModels: (...args: unknown[]) => fetchHostedModels(...args),
  fetchOllamaModels: jest.fn().mockResolvedValue(undefined),
  fetchOpenRouterModels: jest.fn().mockResolvedValue(undefined)
}))

jest.mock("../../lib/blob-to-b64", () => ({
  convertBlobToBase64: jest.fn().mockResolvedValue("data:image/png;base64,xx")
}))

const profile = {
  id: "p1",
  user_id: "u1",
  has_onboarded: true,
  openrouter_api_key: ""
} as any

const workspace = (id: string, imagePath = "") =>
  ({ id, name: `Workspace ${id}`, image_path: imagePath }) as any

/** Renders what the context holds at the moment of the first paint. */
function Probe() {
  const { profile, workspaces, workspaceImages } = useContext(ChatbotUIContext)
  return (
    <>
      <span data-testid="profile">{profile?.id ?? "none"}</span>
      <span data-testid="workspaces">{workspaces.length}</span>
      <span data-testid="images">{workspaceImages.length}</span>
    </>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchHostedModels.mockResolvedValue({ envKeyMap: {}, hostedModels: [] })
  global.fetch = jest.fn().mockResolvedValue({
    blob: async () => new Blob(["x"])
  }) as unknown as typeof fetch
})

/**
 * The model catalogues settle after the assertions in the synchronous tests.
 * Flushing inside the test — rather than in an `afterEach`, which runs after
 * testing-library has already unmounted — keeps that from surfacing as an
 * act() warning about work the test was never asserting on.
 */
const settle = () => act(async () => {})

describe("GlobalState seeding", () => {
  it("has the profile and workspaces on the first render", async () => {
    render(
      <GlobalState
        initialData={{
          profile,
          workspaces: [workspace("w1"), workspace("w2")]
        }}
      >
        <Probe />
      </GlobalState>
    )

    // Synchronously, before any effect has had the chance to fetch anything.
    expect(screen.getByTestId("profile").textContent).toBe("p1")
    expect(screen.getByTestId("workspaces").textContent).toBe("2")

    await settle()
  })

  it("renders without a provider payload rather than failing", async () => {
    // No readable profile — a user mid-signup. This is the signed-out shape.
    render(
      <GlobalState>
        <Probe />
      </GlobalState>
    )

    expect(screen.getByTestId("profile").textContent).toBe("none")
    expect(screen.getByTestId("workspaces").textContent).toBe("0")

    await settle()
  })

  it("sends a user who has not finished signup to setup", async () => {
    render(
      <GlobalState
        initialData={{
          profile: { ...profile, has_onboarded: false },
          workspaces: []
        }}
      >
        <Probe />
      </GlobalState>
    )

    await waitFor(() => expect(push).toHaveBeenCalledWith("/setup"))
    // And does not go on to load anything for a user who is being sent away.
    expect(fetchHostedModels).not.toHaveBeenCalled()
  })

  it("asks for every workspace image at once", async () => {
    // The old loop awaited each image in turn, so N workspaces meant N
    // sequential round trips and N re-renders.
    let resolvers: ((value: string) => void)[] = []
    getWorkspaceImageFromStorage.mockImplementation(
      () => new Promise<string>(resolve => resolvers.push(resolve))
    )

    render(
      <GlobalState
        initialData={{
          profile,
          workspaces: [
            workspace("w1", "a.png"),
            workspace("w2", "b.png"),
            workspace("w3", "c.png")
          ]
        }}
      >
        <Probe />
      </GlobalState>
    )

    // All three are in flight before any of them has answered.
    await waitFor(() => expect(resolvers).toHaveLength(3))

    await act(async () => {
      resolvers.forEach(resolve => resolve("https://example.test/signed"))
    })
    expect(screen.getByTestId("images").textContent).toBe("3")

    await settle()
  })

  it("skips workspaces with no image without leaving a hole", async () => {
    getWorkspaceImageFromStorage.mockResolvedValue(
      "https://example.test/signed"
    )

    render(
      <GlobalState
        initialData={{
          profile,
          workspaces: [workspace("w1", "a.png"), workspace("w2")]
        }}
      >
        <Probe />
      </GlobalState>
    )

    await waitFor(() =>
      expect(screen.getByTestId("images").textContent).toBe("1")
    )
    expect(getWorkspaceImageFromStorage).toHaveBeenCalledTimes(1)

    await settle()
  })

  it("keeps the switcher when one image fails to load", async () => {
    getWorkspaceImageFromStorage
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce("https://example.test/signed")

    render(
      <GlobalState
        initialData={{
          profile,
          workspaces: [workspace("w1", "a.png"), workspace("w2", "b.png")]
        }}
      >
        <Probe />
      </GlobalState>
    )

    await waitFor(() =>
      expect(screen.getByTestId("images").textContent).toBe("1")
    )

    await settle()
  })
})
