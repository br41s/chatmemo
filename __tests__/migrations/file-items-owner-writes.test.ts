/** @jest-environment node */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260726020000_file_items_owner_writes.sql"
  ),
  "utf8"
)

describe("file-item owner write policies", () => {
  it("replaces the permissive all-operations policy", () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Allow full access to own file items"'
    )
    expect(migration).toContain("FOR INSERT\n    TO authenticated")
    expect(migration).toContain("FOR UPDATE\n    TO authenticated")
    expect(migration).toContain("FOR DELETE\n    TO authenticated")
  })

  it("requires both row ownership and parent-file ownership for writes", () => {
    expect(migration.match(/user_id = auth\.uid\(\)/g)?.length).toBeGreaterThan(
      4
    )
    expect(migration.match(/files\.id = file_items\.file_id/g)).toHaveLength(4)
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'")
  })

  it("does not rewrite existing file items while installing the migration", () => {
    const policySection = migration.slice(
      0,
      migration.indexOf("CREATE OR REPLACE FUNCTION public.replace_file_items")
    )

    expect(policySection).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\s+(?:public\.)?file_items\b/i
    )
  })

  it("replaces chunks transactionally only after checking parent ownership", () => {
    const ownerLock = [
      "SELECT user_id",
      "INTO file_owner_id",
      "FROM public.files",
      "WHERE id = p_file_id",
      "FOR UPDATE;"
    ].join("\n    ")
    const ownerCheck = migration.indexOf(ownerLock)
    const deleteItems = migration.indexOf("DELETE FROM public.file_items")

    expect(ownerCheck).toBeGreaterThan(-1)
    expect(deleteItems).toBeGreaterThan(ownerCheck)
    expect(migration).toContain("file_owner_id IS DISTINCT FROM auth.uid()")
    expect(migration).toContain(
      "calculated_total_tokens <> p_total_tokens"
    )
    expect(migration).toContain(
      "FOR current_item IN SELECT value FROM jsonb_array_elements(p_items)"
    )
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain("::extensions.vector")
    expect(migration).not.toContain("::public.vector")
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.replace_file_items(uuid, jsonb, integer)"
    )
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.replace_file_items(uuid, jsonb, integer)"
    )
  })

  it("keeps cited historical chunks but excludes inactive versions from retrieval", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true"
    )
    expect(migration.match(/AND file_items\.active/g)).toHaveLength(2)
    expect(migration.match(/OPERATOR\(extensions\.<=>\)/g)).toHaveLength(4)
    expect(migration).toContain("SET active = false")
    expect(migration).toContain("FROM public.message_file_items")
    expect(migration).toContain(
      "message_file_items.file_item_id = old_item.id"
    )
  })
})
