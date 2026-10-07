/**
 * @jest-environment node
 *
 * The nightly backup runs on the laptop, which holds no database key that can
 * write (PR #70). It reads as chatmemo_backup, a role limited to SELECT on two
 * tables, whose password exists only in ~/.pgpass. The first version of the
 * script kept an inline password slot; this fails the gate if a credential or
 * a wider grant comes back.
 */
import { readFileSync } from "fs"
import { join } from "path"

const root = join(__dirname, "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const migration = read(
  "supabase/migrations/20261007000000_backup_readonly_role.sql"
)
const script = read("scripts/backup-chatmemo.sh")
const sql = migration.replace(/--.*$/gm, "")

describe("nightly backup least privilege", () => {
  it("the migration sets no password and grants nothing beyond reading", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'/i)
    expect(sql).not.toMatch(/\bBYPASSRLS\b/)
    expect(sql).not.toMatch(/\bSUPERUSER\b/)
    const grants = sql.match(/GRANT\s+\w+/gi) ?? []
    expect(grants.map(g => g.split(/\s+/)[1].toUpperCase()).sort()).toEqual([
      "SELECT",
      "USAGE"
    ])
    expect(sql).toMatch(
      /GRANT SELECT ON public\.summaries, public\.user_lessons TO chatmemo_backup/
    )
    for (const policy of sql.match(/CREATE POLICY[\s\S]*?;/g) ?? []) {
      expect(policy).toMatch(/FOR SELECT TO chatmemo_backup/)
    }
  })

  it("the script carries no credential and connects read-only over TLS", () => {
    expect(script).not.toMatch(/postgres(ql)?:\/\/[^\s"]*:[^\s"]*@/)
    expect(script).not.toMatch(/PGPASSWORD|YOUR-PASSWORD|password=/i)
    expect(script).toMatch(/user=\$DB_USER/)
    expect(script).toMatch(/chatmemo_backup\.\$REF/)
    expect(script).toMatch(/sslmode=require/)
    expect(script).toMatch(/--enable-row-security/)
  })
})
