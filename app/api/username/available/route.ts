import { Database } from "@/supabase/types"
import { createClient } from "@supabase/supabase-js"

export const runtime = "edge"

export async function POST(request: Request) {
  const json = await request.json()
  const { username } = json as {
    username: string
  }

  try {
    // Use anon key — this is a public read, no need for service role
    const supabaseAdmin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: usernames, error } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("username", username)

    if (!usernames) {
      throw new Error(error.message)
    }

    return new Response(JSON.stringify({ isAvailable: !usernames.length }), {
      status: 200
    })
  } catch (error: any) {
    const errorMessage = error.error?.message || "An unexpected error occurred"
    const errorCode = error.status || 500
    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
