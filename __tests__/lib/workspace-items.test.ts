import { workspaceItems } from "../../db/workspace-items"
import { supabase } from "../../lib/supabase/browser-client"

// The six per-item files this replaced differed only in the table name. What
// has to stay right is the naming each table implies: `<items>` rows,
// `<item>_workspaces` links, keyed by `<item>_id`.

jest.mock("../../lib/supabase/browser-client", () => ({
  supabase: { from: jest.fn() }
}))

const from = supabase.from as jest.Mock

/** A chainable query whose terminal call resolves to `result`. */
function query(result: unknown) {
  const q: Record<string, jest.Mock> = {}
  for (const m of ["insert", "select", "update", "delete", "eq"]) {
    q[m] = jest.fn(() => q)
  }
  q.single = jest.fn(async () => result)
  ;(q as any).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return q
}

beforeEach(() => from.mockReset())

it("creates the row, then links it into the workspace by <item>_id", async () => {
  const row = query({ data: { id: "p1", user_id: "u1" }, error: null })
  const link = query({ data: [{}], error: null })
  from.mockReturnValueOnce(row).mockReturnValueOnce(link)

  const created = await workspaceItems("presets").create(
    { name: "p", user_id: "u1" } as any,
    "w1"
  )

  expect(created).toEqual({ id: "p1", user_id: "u1" })
  expect(from.mock.calls).toEqual([["presets"], ["preset_workspaces"]])
  expect(link.insert).toHaveBeenCalledWith([
    { user_id: "u1", preset_id: "p1", workspace_id: "w1" }
  ])
})

it.each([
  ["assistants", "assistant_workspaces", "assistant_id"],
  ["collections", "collection_workspaces", "collection_id"],
  ["models", "model_workspaces", "model_id"],
  ["prompts", "prompt_workspaces", "prompt_id"],
  ["tools", "tool_workspaces", "tool_id"]
] as const)("%s unlinks from %s by %s", async (table, linkTable, key) => {
  const link = query({ error: null })
  from.mockReturnValueOnce(link)

  await workspaceItems(table).removeFromWorkspace("item-1", "w1")

  expect(from).toHaveBeenCalledWith(linkTable)
  expect(link.eq).toHaveBeenCalledWith(key, "item-1")
  expect(link.eq).toHaveBeenCalledWith("workspace_id", "w1")
})

it("throws the database's message when a write fails", async () => {
  from.mockReturnValueOnce(
    query({ data: null, error: { message: "permission denied" } })
  )

  await expect(workspaceItems("tools").update("t1", {})).rejects.toThrow(
    "permission denied"
  )
})
