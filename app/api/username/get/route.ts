import {
  LimitedJsonError,
  readLimitedJson
} from "@/lib/server/read-limited-json"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { z } from "zod"

export const runtime = "edge"

const MAX_REQUEST_BYTES = 1024
const REQUEST_BODY_TIMEOUT_MS = 5_000
const requestSchema = z.object({ userId: z.string().uuid() }).strict()

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json"
    }
  })
}

export async function POST(request: Request) {
  try {
    const json = await readLimitedJson(request, {
      maxBytes: MAX_REQUEST_BYTES,
      timeoutMs: REQUEST_BODY_TIMEOUT_MS
    })
    const parsed = requestSchema.safeParse(json)
    if (!parsed.success) {
      return jsonResponse({ message: "User ID is invalid" }, 400)
    }

    const supabase = createClient(cookies())
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required" }, 401)
    }

    const { data: username, error } = await supabase.rpc(
      "get_username_by_user_id",
      { p_user_id: parsed.data.userId }
    )

    if (error) {
      console.error("Username lookup failed", error)
      return jsonResponse({ message: "Username lookup failed" }, 500)
    }

    if (typeof username !== "string") {
      return jsonResponse({ message: "Username not found" }, 404)
    }

    return jsonResponse({ username }, 200)
  } catch (error) {
    if (error instanceof LimitedJsonError) {
      return jsonResponse({ message: error.message }, error.status)
    }

    console.error("Username request failed", error)
    return jsonResponse({ message: "An unexpected error occurred" }, 500)
  }
}
