/**
 * @jest-environment node
 */
import { DELETE } from "../../app/api/summary/delete/route"
import { HttpError } from "../../lib/server/http-error"
import { EmbeddingRequestError } from "../../lib/server/openai-embeddings"
import { LimitedJsonError } from "../../lib/server/read-limited-json"
import { requireUser } from "../../lib/server/require-user"
import { UnsafeToolRequestError } from "../../lib/server/safe-tool-request"
import { createClient } from "../../lib/supabase/server"
import { NextRequest } from "next/server"

jest.mock("../../lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("next/headers", () => ({ cookies: jest.fn(async () => ({})) }))

const createClientMock = createClient as jest.Mock

function session(user: { id: string } | null, error: unknown = null) {
  const eq = jest.fn()
  const query: { delete: jest.Mock; eq: jest.Mock } = {
    delete: jest.fn(() => query),
    eq
  }
  eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null })
  const client = {
    auth: { getUser: jest.fn(async () => ({ data: { user }, error })) },
    from: jest.fn(() => query)
  }
  createClientMock.mockReturnValue(client)
  return { client, eq }
}

beforeEach(() => jest.clearAllMocks())

describe("requireUser", () => {
  it("answers 401 when there is no session", async () => {
    session(null)

    const auth = await requireUser()

    expect("response" in auth && auth.response.status).toBe(401)
  })

  it("answers 401 when the auth server rejects the session", async () => {
    session({ id: "user-1" }, new Error("JWT expired"))

    const auth = await requireUser()

    expect("response" in auth).toBe(true)
  })

  it("returns the session's user and its client", async () => {
    const { client } = session({ id: "user-1" })

    const auth = await requireUser()

    expect(auth).toEqual({ supabase: client, userId: "user-1" })
  })
})

describe("a route on requireUser", () => {
  function deleteRequest(id: string) {
    return new NextRequest("http://localhost/api/summary/delete", {
      method: "DELETE",
      body: JSON.stringify({ id })
    })
  }

  it("says 401, not 500, without a session", async () => {
    session(null)

    const response = await DELETE(deleteRequest("row-1"))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      message: "Authentication required"
    })
  })

  it("scopes the delete to the session's user", async () => {
    const { eq } = session({ id: "user-1" })

    const response = await DELETE(deleteRequest("row-1"))

    expect(response.status).toBe(200)
    expect(eq).toHaveBeenCalledWith("id", "row-1")
    expect(eq).toHaveBeenCalledWith("user_id", "user-1")
  })
})

describe("HttpError", () => {
  it("is the one base the routes check for user-facing errors", () => {
    for (const error of [
      new LimitedJsonError("too large", 413),
      new EmbeddingRequestError("bad key", 401),
      new UnsafeToolRequestError("blocked")
    ]) {
      expect(error).toBeInstanceOf(HttpError)
    }
    expect(new UnsafeToolRequestError("blocked").status).toBe(400)
  })
})
