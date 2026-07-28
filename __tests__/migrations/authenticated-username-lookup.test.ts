/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728000000_authenticated_username_lookup.sql"
  ),
  "utf8"
)

describe("authenticated username lookup migration", () => {
  it("uses fixed-search-path security definer functions", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2)
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2)
    expect(migration).toContain("auth.uid() IS NOT NULL")
  })

  it("exposes only the two functions to authenticated users", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC"
    )
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.get_username_by_user_id(uuid) FROM PUBLIC"
    )
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated"
    )
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_username_by_user_id(uuid) TO authenticated"
    )
  })

  it("excludes the current user's profile from availability conflicts", () => {
    expect(migration).toContain("profiles.user_id <> auth.uid()")
    expect(migration).toContain("^[A-Za-z0-9_]{3,25}$")
  })
})
