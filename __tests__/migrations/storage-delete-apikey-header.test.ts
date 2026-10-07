/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261007020000_storage_delete_apikey_header.sql"
  ),
  "utf8"
)

describe("storage delete apikey header migration", () => {
  it("sends the key in apikey, and as a Bearer token only when it is a JWT", () => {
    expect(migration).toContain(
      "req_headers := ARRAY[extensions.http_header('apikey', service_role_key)]"
    )
    expect(migration).toMatch(
      /IF service_role_key LIKE 'eyJ%' THEN\s+req_headers := req_headers \|\| extensions\.http_header\('authorization'/
    )
  })

  it("keeps the lockdown: Vault, fixed search path, warn on a missing secret", () => {
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain("name = 'storage_delete_service_role_key'")
    expect(migration).toMatch(
      /IF project_url IS NULL OR service_role_key IS NULL THEN\s+RAISE WARNING/
    )
    expect(migration).not.toMatch(/eyJ[A-Za-z0-9_-]{6,}|sb_secret_[A-Za-z0-9]/)
  })
})
