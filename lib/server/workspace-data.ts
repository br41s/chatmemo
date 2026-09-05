import { createClient } from "@/lib/supabase/server"
import { Tables } from "@/supabase/types"
import { cookies } from "next/headers"

/**
 * The workspace shell's data, read on the server (ARCH-11).
 *
 * These ten reads used to run in the browser, from a client layout, behind a
 * full-page spinner: the user got HTML with nothing in it, React hydrated,
 * *then* ten requests went out, and only when the last one landed did anything
 * appear. Moving them here means the shell arrives with its data already in the
 * RSC payload and the spinner has nothing left to wait for.
 *
 * The queries are deliberately identical to the client ones they replace —
 * same tables, same select strings, same filters — so this is a change of
 * *where* the reads happen, not *what* they ask for. Seven of them fetch the
 * same `workspaces` row with a different embed and could collapse into one
 * request; that is worth doing, and worth doing separately from a change to
 * the app's most central layout.
 *
 * RLS is still the guard. This client carries the user's cookies, so it sees
 * exactly what the browser client saw and nothing more.
 */
export interface WorkspaceData {
  workspace: Tables<"workspaces">
  assistants: Tables<"assistants">[]
  chats: Tables<"chats">[]
  collections: Tables<"collections">[]
  folders: Tables<"folders">[]
  files: Tables<"files">[]
  presets: Tables<"presets">[]
  prompts: Tables<"prompts">[]
  tools: Tables<"tools">[]
  models: Tables<"models">[]
}

/**
 * `null` means "this workspace is not yours or does not exist" — the two are
 * the same answer under RLS, and both belong in `notFound()` rather than in a
 * raw Postgres string thrown into React, which is what `db/*.ts` did.
 */
export async function getWorkspaceData(
  workspaceId: string
): Promise<WorkspaceData | null> {
  const supabase = createClient(cookies())

  const [
    workspace,
    assistants,
    chats,
    collections,
    folders,
    files,
    presets,
    prompts,
    tools,
    models
  ] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).single(),
    supabase
      .from("workspaces")
      .select("id, name, assistants (*)")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("chats")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("workspaces")
      .select("id, name, collections (*)")
      .eq("id", workspaceId)
      .single(),
    supabase.from("folders").select("*").eq("workspace_id", workspaceId),
    supabase
      .from("workspaces")
      .select("id, name, files (*)")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("workspaces")
      .select("id, name, presets (*)")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("workspaces")
      .select("id, name, prompts (*)")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("workspaces")
      .select("id, name, tools (*)")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("workspaces")
      .select("id, name, models (*)")
      .eq("id", workspaceId)
      .single()
  ])

  // The workspace row is the only read that decides whether this page exists.
  if (!workspace.data) return null

  // A failed embed is not a missing workspace. Degrading one list to empty
  // costs the user a sidebar section; refusing to render costs them the app.
  return {
    workspace: workspace.data,
    assistants: assistants.data?.assistants ?? [],
    chats: chats.data ?? [],
    collections: collections.data?.collections ?? [],
    folders: folders.data ?? [],
    files: files.data?.files ?? [],
    presets: presets.data?.presets ?? [],
    prompts: prompts.data?.prompts ?? [],
    tools: tools.data?.tools ?? [],
    models: models.data?.models ?? []
  }
}
