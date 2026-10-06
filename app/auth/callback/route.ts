import { safeNextPath } from "@/lib/safe-next-path"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = requestUrl.searchParams.get("next")

  if (code) {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    await supabase.auth.exchangeCodeForSession(code)
  }

  // `next` is only ever a path on this site. Concatenating it unchecked let
  // `?next=@evil.example/login` produce a URL whose host is evil.example.
  return NextResponse.redirect(new URL(safeNextPath(next), requestUrl.origin))
}
