/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(process.cwd(), "supabase/migrations")
const name = "20261007010000_storage_delete_lockdown.sql"
const migration = readFileSync(join(dir, name), "utf8")

describe("storage delete lockdown migration (audit M5)", () => {
  it("carries no URL or key of its own", () => {
    expect(migration).not.toMatch(/eyJ[A-Za-z0-9_-]{6,}/)
    expect(migration).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\.co/)
  })

  it("reads both values from Vault with a fixed search path", () => {
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain("name = 'storage_delete_project_url'")
    expect(migration).toContain("name = 'storage_delete_service_role_key'")
  })

  it("takes both functions away from PUBLIC, anon and authenticated", () => {
    for (const fn of [
      "public.delete_storage_object(text, text)",
      "public.delete_storage_object_from_bucket(text, text)"
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated`
      )
    }
    expect(migration).toContain(
      "anon or authenticated can still execute a storage-delete function"
    )
  })

  it("never lets a missing Vault secret block the delete that fired it", () => {
    expect(migration).toMatch(
      /IF project_url IS NULL OR service_role_key IS NULL THEN\s+RAISE WARNING/
    )
  })

  it("no later migration puts a key back into a function body", () => {
    const later = readdirSync(dir).filter(f => f.endsWith(".sql") && f > name)
    for (const file of later) {
      const sql = readFileSync(join(dir, file), "utf8")
      expect({
        file,
        keyLiteral: /service_role_key\s+text\s*:=\s*'/i.test(sql)
      }).toEqual({
        file,
        keyLiteral: false
      })
    }
  })
})
