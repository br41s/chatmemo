/**
 * @jest-environment node
 *
 * The cloud environment's setup script downloads the hook from the deployed
 * app and installs it only if its hash is the one the admin guide names.
 * Whoever controls the deployment would otherwise get code execution in
 * every cloud session container. The pin only protects if it is current, so
 * this fails the gate whenever the hook changes without the guide.
 */
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { join } from "path"

const root = join(__dirname, "..", "..")

it("the admin guide pins the hook that is served", () => {
  const hook = readFileSync(
    join(root, "public", "hooks", "chatmemo-cloud-sync.mjs")
  )
  const actual = createHash("sha256").update(hook).digest("hex")

  const guide = readFileSync(join(root, "docs", "ADMIN_GUIDE.md"), "utf8")
  const pinned = guide.match(/^expected_sha256="?([0-9a-f]{64})"?$/m)?.[1]

  expect(pinned).toBeDefined()
  expect(pinned).toBe(actual)
})
