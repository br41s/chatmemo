import { createClient } from "@/lib/supabase/middleware"
import { i18nRouter } from "next-i18n-router"
import { NextResponse, type NextRequest } from "next/server"
import i18nConfig from "./i18nConfig"

// Cookie caches the home workspace ID so we skip the DB query on repeat visits.
// Format: "userId:workspaceId" — userId prefix prevents serving a stale entry
// after a different user logs in on the same browser.
const HOME_WORKSPACE_COOKIE = "chatmemo-hwid"
const COOKIE_MAX_AGE = 60 * 60 * 24 // 24 hours

export async function middleware(request: NextRequest) {
  const i18nResult = i18nRouter(request, i18nConfig)
  if (i18nResult) return i18nResult

  try {
    const { supabase, response } = createClient(request)

    const session = await supabase.auth.getSession()

    const redirectToChat = session && request.nextUrl.pathname === "/"

    if (redirectToChat) {
      const userId = session.data.session?.user.id

      // Fast path: serve from cookie, no DB round-trip.
      const cached = request.cookies.get(HOME_WORKSPACE_COOKIE)?.value
      if (cached) {
        const sep = cached.indexOf(":")
        const cachedUserId = cached.slice(0, sep)
        const cachedWorkspaceId = cached.slice(sep + 1)
        if (cachedUserId === userId && cachedWorkspaceId) {
          return NextResponse.redirect(
            new URL(`/${cachedWorkspaceId}/chat`, request.url)
          )
        }
      }

      // Slow path: query DB, then cache the result.
      const { data: homeWorkspace, error } = await supabase
        .from("workspaces")
        .select("id")
        .eq("user_id", userId)
        .eq("is_home", true)
        .single()

      if (!homeWorkspace) {
        throw new Error(error?.message)
      }

      const redirectResponse = NextResponse.redirect(
        new URL(`/${homeWorkspace.id}/chat`, request.url)
      )
      redirectResponse.cookies.set(
        HOME_WORKSPACE_COOKIE,
        `${userId}:${homeWorkspace.id}`,
        {
          maxAge: COOKIE_MAX_AGE,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production"
        }
      )
      return redirectResponse
    }

    return response
  } catch (e) {
    return NextResponse.next({
      request: {
        headers: request.headers
      }
    })
  }
}

export const config = {
  matcher: "/((?!api|static|.*\\..*|_next|auth).*)"
}
