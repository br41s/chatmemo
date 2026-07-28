/** @jest-environment node */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260726000000_tools_shared_without_secrets.sql"
  ),
  "utf8"
)

describe("shared tools without custom headers migration", () => {
  it("replaces the permissive public policy instead of adding an OR branch", () => {
    const dropPosition = migration.indexOf(
      'DROP POLICY IF EXISTS "Allow view access to non-private tools"'
    )
    const createPosition = migration.indexOf(
      'CREATE POLICY "Allow authenticated view of shared tools without headers"'
    )

    expect(dropPosition).toBeGreaterThanOrEqual(0)
    expect(createPosition).toBeGreaterThan(dropPosition)
    expect(migration).toContain("FOR SELECT\n    TO authenticated")
    expect(migration).not.toMatch(
      /DROP POLICY(?: IF EXISTS)? "Allow full access to own tools"\s+ON public\.tools/i
    )
  })

  it("uses the same explicit empty-header predicate in RLS and CHECK", () => {
    const emptyHeadersPredicate =
      /custom_headers IN \(\s*'\{\}'::jsonb,\s*'""'::jsonb,\s*'null'::jsonb\s*\)/g
    const emptyObjectStringTypeGuard =
      /jsonb_typeof\(custom_headers\) = 'string'/g
    const emptyObjectStringPattern = String.raw`custom_headers #>> '{}' ~ E'^[ \t\n\r]*[{][ \t\n\r]*[}][ \t\n\r]*$'`

    expect(migration.match(emptyHeadersPredicate)).toHaveLength(2)
    expect(migration.match(emptyObjectStringTypeGuard)).toHaveLength(2)
    expect(migration.split(emptyObjectStringPattern)).toHaveLength(3)
    expect(migration).toContain(
      "ADD CONSTRAINT tools_shared_without_custom_headers"
    )
    expect(migration).toContain("NOT VALID")
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'")
  })

  it("allows only JSON whitespace around an empty object string", () => {
    expect(migration).toContain(
      String.raw`E'^[ \t\n\r]*[{][ \t\n\r]*[}][ \t\n\r]*$'`
    )
    expect(migration).not.toContain("[[:space:]]")
  })

  it("contains no direct data-changing statements for historical tool rows", () => {
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?tools\b/i
    )
  })
})
