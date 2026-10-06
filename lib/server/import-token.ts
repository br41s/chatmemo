import { timingSafeEqual } from "crypto"

// The import endpoint's bearer tokens. Each writer gets its own, so a leak is
// revoked on its own and reaches only what that writer may do:
//
//   CHATMEMO_IMPORT_TOKEN        the laptop scripts and the bookmarklets —
//                                may post anything for the owner
//   CHATMEMO_CLOUD_IMPORT_TOKEN  the Claude Code cloud hook — sits in the
//                                cloud container's environment, where any
//                                command the agent runs can read it, so it may
//                                only post Claude Code sessions
//
// Both resolve to CHATMEMO_IMPORT_USER_ID, the owner written by setup:sync.

export interface ImportTokenGrant {
  userId: string
  /** The sessionKey prefix this token is limited to, or null for any post. */
  keyPrefix: string | null
}

export const CLOUD_KEY_PREFIX = "claude-code:"

type Env = Record<string, string | undefined>

function matches(presented: string, configured: string | undefined): boolean {
  if (!configured) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(configured)
  // Constant-time: the comparison reveals the length, never the content.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The grant a bearer token carries.
 *
 * `null` when the header carries no bearer token (the caller then tries the
 * session cookie), `"unconfigured"` when no token is set up at all, and
 * `"invalid"` when the token matches none.
 */
export function resolveImportToken(
  authHeader: string | null,
  env: Env = process.env
): ImportTokenGrant | "unconfigured" | "invalid" | null {
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7).trim()

  const userId = env.CHATMEMO_IMPORT_USER_ID
  const general = env.CHATMEMO_IMPORT_TOKEN
  const cloud = env.CHATMEMO_CLOUD_IMPORT_TOKEN
  if (!userId || (!general && !cloud)) return "unconfigured"

  if (matches(token, general)) return { userId, keyPrefix: null }
  if (matches(token, cloud)) return { userId, keyPrefix: CLOUD_KEY_PREFIX }
  return "invalid"
}

/** Whether a grant allows a post with this sessionKey. */
export function grantAllows(
  grant: ImportTokenGrant,
  sessionKey: string | null
): boolean {
  if (grant.keyPrefix === null) return true
  return sessionKey !== null && sessionKey.startsWith(grant.keyPrefix)
}
