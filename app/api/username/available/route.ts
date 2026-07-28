import { PROFILE_USERNAME_MAX, PROFILE_USERNAME_MIN } from "@/db/limits"
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
const requestSchema = z
  .object({
    username: z
      .string()
      .min(PROFILE_USERNAME_MIN)
      .max(PROFILE_USERNAME_MAX)
      .regex(/^[A-Za-z0-9_]+$/)
  })
  .strict()

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
      return jsonResponse({ message: "Username is invalid" }, 400)
    }

    const supabase = createClient(cookies())
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required" }, 401)
    }

    const { data: isAvailable, error } = await supabase.rpc(
      "is_username_available",
      { p_username: parsed.data.username }
    )

    if (error || typeof isAvailable !== "boolean") {
      console.error("Username availability lookup failed", error)
      return jsonResponse({ message: "Username lookup failed" }, 500)
    }

    return jsonResponse({ isAvailable }, 200)
  } catch (error) {
    if (error instanceof LimitedJsonError) {
      return jsonResponse({ message: error.message }, error.status)
    }

    console.error("Username availability request failed", error)
    return jsonResponse({ message: "An unexpected error occurred" }, 500)
  }
}
