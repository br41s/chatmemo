import { getInitialData } from "../../lib/server/initial-data"

// Same shape of module as `workspace-data.ts`: the queries are copied from the
// client reads they replace, so what is worth testing is the contract this
// adds — when there is nothing to seed, and whether a missing workspace list
// is the same thing as a missing profile. It is not.

jest.mock("next/headers", () => ({ cookies: () => ({}) }))

type Result = { data: unknown; error: unknown }

function mockSupabase(results: Record<string, Result>) {
  const seen: { table: string; order?: unknown }[] = []

  return {
    client: {
      from(table: string) {
        const call: { table: string; order?: unknown } = { table }
        seen.push(call)

        const builder: any = {
          select: () => builder,
          eq: () => builder,
          order(column: string, options: unknown) {
            call.order = { column, options }
            return builder
          },
          single: () => builder,
          then: (resolve: (value: Result) => unknown) =>
            Promise.resolve(
              results[table] ?? { data: null, error: { message: "no stub" } }
            ).then(resolve)
        }

        return builder
      }
    },
    seen
  }
}

jest.mock("../../lib/supabase/server", () => ({
  createClient: () => (global as any).__supabaseMock
}))

function install(results: Record<string, Result>) {
  const { client, seen } = mockSupabase(results)
  ;(global as any).__supabaseMock = client
  return seen
}

const profile = { id: "p1", user_id: "u1", has_onboarded: true }

afterEach(() => {
  delete (global as any).__supabaseMock
})

describe("getInitialData", () => {
  it("returns the profile and the workspace list", async () => {
    install({
      profiles: { data: profile, error: null },
      workspaces: { data: [{ id: "w1" }, { id: "w2" }], error: null }
    })

    const data = await getInitialData("u1")

    expect(data!.profile).toEqual(profile)
    expect(data!.workspaces).toHaveLength(2)
  })

  it("is null when there is no readable profile", async () => {
    // A user mid-signup, or a row RLS will not return. The layout renders
    // without the provider rather than throwing out of a server component.
    install({
      profiles: { data: null, error: { message: "no rows" } },
      workspaces: { data: [], error: null }
    })

    expect(await getInitialData("u1")).toBeNull()
  })

  it("still seeds a profile whose workspaces failed to load", async () => {
    // A fresh account between signup and setup genuinely has none, and the
    // profile is what decides where that user gets sent.
    install({
      profiles: { data: profile, error: null },
      workspaces: { data: null, error: { message: "boom" } }
    })

    const data = await getInitialData("u1")

    expect(data!.profile).toEqual(profile)
    expect(data!.workspaces).toEqual([])
  })

  it("asks for workspaces newest first", async () => {
    const seen = install({
      profiles: { data: profile, error: null },
      workspaces: { data: [], error: null }
    })

    await getInitialData("u1")

    expect(seen.find(call => call.table === "workspaces")!.order).toEqual({
      column: "created_at",
      options: { ascending: false }
    })
  })

  it("reads both together rather than in sequence", async () => {
    const seen = install({
      profiles: { data: profile, error: null },
      workspaces: { data: [], error: null }
    })

    await getInitialData("u1")

    expect(seen.map(call => call.table).sort()).toEqual([
      "profiles",
      "workspaces"
    ])
  })
})
