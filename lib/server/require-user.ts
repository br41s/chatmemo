import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

/**
 * The signed-in user and a Supabase client bound to their session — or the
 * 401 to return when there is no session.
 *
 * For routes that only need `user_id`. getServerProfile also loads the whole
 * profile row, and throws on a missing session instead of saying 401.
 */
export async function requireUser(): Promise<
  | { supabase: ReturnType<typeof createClient>; userId: string }
  | { response: Response }
> {
  const supabase = createClient(await cookies())
  const {
    data: { user },
    error
  } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      response: new Response(
        JSON.stringify({ message: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    }
  }

  return { supabase, userId: user.id }
}
