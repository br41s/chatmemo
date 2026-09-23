import { supabase } from "@/lib/supabase/browser-client"
import { Database, Tables } from "@/supabase/types"
import { SupabaseClient } from "@supabase/supabase-js"

// Assistants, collections, models, presets, prompts and tools were six copies
// of one file with the table name changed: a row table, an `<item>_workspaces`
// link table, and the same calls against both.
//
// supabase-js cannot type a query whose table name is itself a type parameter,
// so the queries below run on an untyped handle. The types are enforced at the
// boundary instead: every function takes and returns the concrete table's
// Insert / Update / Row shape, so callers are checked as strictly as before.

type Schema = Database["public"]["Tables"]

/** Row tables whose items are shared into workspaces through a link table. */
export type WorkspaceItemTable =
  | "assistants"
  | "collections"
  | "models"
  | "presets"
  | "prompts"
  | "tools"

type Row<T extends WorkspaceItemTable> = Schema[T]["Row"]
type Insert<T extends WorkspaceItemTable> = Schema[T]["Insert"]
type Update<T extends WorkspaceItemTable> = Schema[T]["Update"]
type Singular<T extends WorkspaceItemTable> = T extends `${infer S}s`
  ? S
  : never

/** A link-table row: `{ user_id, <item>_id, workspace_id }`. */
export type WorkspaceLink<T extends WorkspaceItemTable> = {
  user_id: string
  workspace_id: string
} & Record<`${Singular<T>}_id`, string>

const untyped = supabase as unknown as SupabaseClient

export function workspaceItems<T extends WorkspaceItemTable>(table: T) {
  const key = `${table.slice(0, -1)}_id` as `${Singular<T>}_id`
  const link = `${table.slice(0, -1)}_workspaces`

  const createWorkspaceLinks = async (
    items: WorkspaceLink<T>[]
  ): Promise<Schema[`${Singular<T>}_workspaces` & keyof Schema]["Row"][]> => {
    const { data, error } = await untyped.from(link).insert(items).select("*")
    if (error) throw new Error(error.message)
    return data
  }

  return {
    /** The item with the workspaces it is shared into. */
    getWorkspaces: async (
      itemId: string
    ): Promise<{
      id: string
      name: string
      workspaces: Tables<"workspaces">[]
    }> => {
      const { data, error } = await untyped
        .from(table)
        .select("id, name, workspaces (*)")
        .eq("id", itemId)
        .single()
      if (!data) throw new Error(error?.message)
      return data
    },

    /** Insert the item and share it into `workspaceId`. */
    create: async (item: Insert<T>, workspaceId: string): Promise<Row<T>> => {
      const { data, error } = await untyped
        .from(table)
        .insert([item])
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      await createWorkspaceLinks([
        {
          user_id: data.user_id,
          [key]: data.id,
          workspace_id: workspaceId
        } as WorkspaceLink<T>
      ])
      return data
    },

    createWorkspaceLinks,

    update: async (itemId: string, item: Update<T>): Promise<Row<T>> => {
      const { data, error } = await untyped
        .from(table)
        .update(item)
        .eq("id", itemId)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return data
    },

    remove: async (itemId: string) => {
      const { error } = await untyped.from(table).delete().eq("id", itemId)
      if (error) throw new Error(error.message)
      return true
    },

    removeFromWorkspace: async (itemId: string, workspaceId: string) => {
      const { error } = await untyped
        .from(link)
        .delete()
        .eq(key, itemId)
        .eq("workspace_id", workspaceId)
      if (error) throw new Error(error.message)
      return true
    }
  }
}
