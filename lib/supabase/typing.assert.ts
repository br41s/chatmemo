import type { supabase as browserClient } from "@/lib/supabase/browser-client"
import type { createClient as createMiddlewareClient } from "@/lib/supabase/middleware"
import type { createClient as createServerClient } from "@/lib/supabase/server"
import type { Database } from "@/supabase/types"

// A guard, not a test. It runs in `npm run type-check`, which is what the
// pre-push hook enforces, and it holds nothing at runtime — every import is
// type-only and the function below is never called.
//
// Two of these three clients used to resolve to `any` for columns, write
// payloads and return types, because the schema generic was missing. Nothing
// failed: `user_lessons` was absent from supabase/types.ts entirely while six
// places queried it, and the middleware filtered a workspace lookup on a value
// that could be `undefined`.
//
// If a generic goes missing again these stop erroring, and TypeScript reports
// the `@ts-expect-error` directives as unused — which fails the gate.
//
// Note the version of supabase-js here does not check table names or select
// strings, so those make poor guards. Write payloads, filter values and result
// shapes do.

declare const server: ReturnType<typeof createServerClient>
declare const middleware: ReturnType<typeof createMiddlewareClient>["supabase"]
declare const browser: typeof browserClient

async function schemaIsEnforced() {
  // A column written with the wrong type must not type-check.
  // @ts-expect-error
  await server.from("user_lessons").insert({ user_id: 123 })
  // @ts-expect-error
  await browser.from("workspaces").insert({ name: 123 })

  // A filter value that might be missing must not type-check. This is the exact
  // shape of the middleware bug: `session.data.session?.user.id` is
  // `string | undefined`, and the untyped client took it happily.
  const maybeUserId: string | undefined = undefined
  // @ts-expect-error
  await middleware.from("workspaces").select("id").eq("user_id", maybeUserId)

  // And a row that comes back must have known columns rather than `any`.
  const { data } = await server
    .from("user_lessons")
    .select("content")
    .maybeSingle()
  // @ts-expect-error
  const contentIsNotANumber: number = data?.content

  return contentIsNotANumber
}

void schemaIsEnforced

/**
 * A table the code queries. Naming it here fails the build if it ever drops out
 * of the generated schema again, rather than at runtime in the memory injector.
 */
export type LessonsRow = Database["public"]["Tables"]["user_lessons"]["Row"]
