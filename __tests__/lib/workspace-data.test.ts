import { getWorkspaceData } from "../../lib/server/workspace-data"

// The PostgREST query strings here are copied verbatim from the client reads
// they replace, so what is worth testing is not the queries — it is the two
// decisions this module adds on top of them: when a workspace counts as
// missing, and what happens to the other nine reads when one of them fails.

jest.mock("next/headers", () => ({ cookies: () => ({}) }))

type Result = { data: unknown; error: unknown }

/** Records every query and answers from a table of canned results. */
function mockSupabase(results: Record<string, Result>) {
  const seen: { table: string; select: string; order?: unknown }[] = []

  const client = {
    from(table: string) {
      const call: { table: string; select: string; order?: unknown } = {
        table,
        select: ""
      }

      // Every method returns the same thenable, which is how the PostgREST
      // builder behaves: the request is only sent when it is awaited.
      const builder: any = {
        select(columns: string) {
          call.select = columns.replace(/\s+/g, " ").trim()
          seen.push(call)
          return builder
        },
        eq: () => builder,
        order(column: string, options: unknown) {
          call.order = { column, options }
          return builder
        },
        single: () => builder,
        then(resolve: (value: Result) => unknown) {
          const key = `${call.table}:${call.select}`
          return Promise.resolve(
            results[key] ?? {
              data: null,
              error: { message: `no stub: ${key}` }
            }
          ).then(resolve)
        }
      }

      return builder
    }
  }

  return { client, seen }
}

jest.mock("../../lib/supabase/server", () => ({
  createClient: () => (global as any).__supabaseMock
}))

function install(results: Record<string, Result>) {
  const { client, seen } = mockSupabase(results)
  ;(global as any).__supabaseMock = client
  return seen
}

const workspace = { id: "w1", name: "Work", default_model: "gpt-4o" }

/** Every read answering with something, so a test can knock one out. */
const allGood = (): Record<string, Result> => ({
  "workspaces:*": { data: workspace, error: null },
  "workspaces:id, name, assistants (*)": {
    data: { assistants: [{ id: "a1" }] },
    error: null
  },
  "chats:*": { data: [{ id: "c1" }], error: null },
  "workspaces:id, name, collections (*)": {
    data: { collections: [{ id: "col1" }] },
    error: null
  },
  "folders:*": { data: [{ id: "f1" }], error: null },
  "workspaces:id, name, files (*)": {
    data: { files: [{ id: "file1" }] },
    error: null
  },
  "workspaces:id, name, presets (*)": {
    data: { presets: [{ id: "p1" }] },
    error: null
  },
  "workspaces:id, name, prompts (*)": {
    data: { prompts: [{ id: "pr1" }] },
    error: null
  },
  "workspaces:id, name, tools (*)": {
    data: { tools: [{ id: "t1" }] },
    error: null
  },
  "workspaces:id, name, models (*)": {
    data: { models: [{ id: "m1" }] },
    error: null
  }
})

afterEach(() => {
  delete (global as any).__supabaseMock
})

describe("getWorkspaceData", () => {
  it("returns every list the shell needs", async () => {
    install(allGood())

    const data = await getWorkspaceData("w1")

    expect(data).not.toBeNull()
    expect(data!.workspace).toEqual(workspace)
    expect(data!.assistants).toHaveLength(1)
    expect(data!.chats).toHaveLength(1)
    expect(data!.collections).toHaveLength(1)
    expect(data!.folders).toHaveLength(1)
    expect(data!.files).toHaveLength(1)
    expect(data!.presets).toHaveLength(1)
    expect(data!.prompts).toHaveLength(1)
    expect(data!.tools).toHaveLength(1)
    expect(data!.models).toHaveLength(1)
  })

  it("is null when the workspace is not readable", async () => {
    // RLS gives the same answer for "does not exist" and "not yours", and the
    // layout turns both into a 404 rather than a thrown Postgres string.
    const results = allGood()
    results["workspaces:*"] = {
      data: null,
      error: { message: "row not found" }
    }
    install(results)

    expect(await getWorkspaceData("w1")).toBeNull()
  })

  it("degrades one failed list to empty rather than failing the page", async () => {
    // Losing the sidebar's tools section costs the user a section. Throwing
    // costs them the app.
    const results = allGood()
    results["workspaces:id, name, tools (*)"] = {
      data: null,
      error: { message: "boom" }
    }
    install(results)

    const data = await getWorkspaceData("w1")

    expect(data!.tools).toEqual([])
    expect(data!.assistants).toHaveLength(1)
    expect(data!.workspace).toEqual(workspace)
  })

  it("survives an embed that comes back without its relation", async () => {
    const results = allGood()
    results["workspaces:id, name, presets (*)"] = {
      data: { id: "w1", name: "Work" },
      error: null
    }
    install(results)

    expect((await getWorkspaceData("w1"))!.presets).toEqual([])
  })

  it("asks for chats newest first", async () => {
    // The sidebar lists most-recent-first. An unordered read would leave the
    // order to Postgres, which is the defect the message pagination had.
    const seen = install(allGood())

    await getWorkspaceData("w1")

    const chats = seen.find(call => call.table === "chats")
    expect(chats!.order).toEqual({
      column: "created_at",
      options: { ascending: false }
    })
  })

  it("issues the ten reads together rather than in sequence", async () => {
    const seen = install(allGood())

    await getWorkspaceData("w1")

    expect(seen).toHaveLength(10)
  })
})
