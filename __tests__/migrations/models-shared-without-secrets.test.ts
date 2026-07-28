/** @jest-environment node */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260726010000_models_shared_without_secrets.sql"
  ),
  "utf8"
)

describe("shared models without API keys migration", () => {
  it("replaces the permissive shared-row policy", () => {
    const dropPosition = migration.indexOf(
      'DROP POLICY IF EXISTS "Allow view access to non-private models"'
    )
    const createPosition = migration.indexOf(
      'CREATE POLICY "Allow authenticated view of shared models without keys"'
    )

    expect(dropPosition).toBeGreaterThanOrEqual(0)
    expect(createPosition).toBeGreaterThan(dropPosition)
    expect(migration).toContain("FOR SELECT\n    TO authenticated")
    expect(migration).not.toMatch(
      /DROP POLICY(?: IF EXISTS)? "Allow full access to own models"\s+ON public\.models/i
    )
  })

  it("uses the same exact empty-key condition in RLS and CHECK", () => {
    expect(migration.match(/api_key = ''/g)).toHaveLength(2)
    expect(migration).toContain("ADD CONSTRAINT models_shared_without_api_key")
    expect(migration).toContain("NOT VALID")
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'")
    expect(migration).not.toMatch(/\b(?:trim|btrim|coalesce)\s*\(/i)
  })

  it("does not rewrite historical model rows", () => {
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?models\b/i
    )
  })
})
