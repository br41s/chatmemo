import { createClient } from "@/lib/supabase/server"
import { Tables } from "@/supabase/types"
import { cookies } from "next/headers"

/**
 * The two reads every signed-in page needs, done on the server (ARCH-11).
 *
 * `GlobalState` used to fetch these in the browser on mount, at the head of a
 * chain that ran strictly in order: session, then profile, then workspaces,
 * then one signed URL per workspace image *serially*, then the hosted model
 * catalogue, then OpenRouter. The profile is what almost every surface reads
 * to decide what to show, so nothing that depends on it could render until the
 * first two hops finished — and unlike the workspace shell there was no
 * spinner to explain the wait, just an app that looked empty for a moment.
 *
 * Fetching them here means the profile and the workspace list are in the very
 * first render, server included, rather than arriving after hydration.
 *
 * What stays in the browser is what has to: the model catalogues, which depend
 * on which keys the user holds and reach third parties (Ollama is on the
 * user's own machine and is not reachable from the server at all), and the
 * workspace images, which end up base64-encoded for the switcher.
 */
export interface InitialData {
  profile: Tables<"profiles">
  workspaces: Tables<"workspaces">[]
}

/**
 * `null` when there is no readable profile — a user mid-signup, or a row RLS
 * will not return. The caller renders the app without the provider, exactly as
 * it did for a signed-out visitor, rather than throwing a Postgres string out
 * of a layout.
 */
export async function getInitialData(
  userId: string
): Promise<InitialData | null> {
  const supabase = createClient(cookies())

  const [profile, workspaces] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).single(),
    supabase
      .from("workspaces")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
  ])

  if (!profile.data) return null

  // A profile with no readable workspaces is a real state — a fresh account
  // between signup and setup — and not a reason to refuse to render.
  return { profile: profile.data, workspaces: workspaces.data ?? [] }
}
