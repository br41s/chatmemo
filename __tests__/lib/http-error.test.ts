/** @jest-environment node */

import {
  describeProviderError,
  HttpError,
  providerErrorResponse,
  readJsonBody
} from "../../lib/server/http-error"

describe("describeProviderError", () => {
  it("rewrites a rejected key (401) into a profile-settings hint", () => {
    const error = Object.assign(new Error('401 {"type":"error"}'), {
      status: 401
    })

    expect(describeProviderError(error, "Anthropic")).toEqual({
      message:
        "Anthropic API Key is incorrect. Please fix it in your profile settings.",
      status: 401
    })
  })

  it("recognises Google's bad key, which arrives as a 400", () => {
    const error = Object.assign(
      new Error("[400 Bad Request] API key not valid. Please pass a valid key"),
      { status: 400 }
    )

    expect(describeProviderError(error, "Google Gemini")).toEqual({
      message:
        "Google Gemini API Key is incorrect. Please fix it in your profile settings.",
      status: 400
    })
  })

  it("passes other provider messages and statuses through", () => {
    const error = Object.assign(new Error("Rate limit reached"), {
      status: 429
    })

    expect(describeProviderError(error, "Groq")).toEqual({
      message: "Rate limit reached",
      status: 429
    })
  })

  it("falls back to 500 when the status is missing or not an HTTP error", () => {
    expect(
      describeProviderError(new Error("socket hang up"), "OpenAI")
    ).toEqual({ message: "socket hang up", status: 500 })
    expect(
      describeProviderError(Object.assign(new Error(""), { status: 200 }), "X")
    ).toEqual({ message: "An unexpected error occurred", status: 500 })
    expect(describeProviderError(undefined, "X")).toEqual({
      message: "An unexpected error occurred",
      status: 500
    })
  })
})

describe("providerErrorResponse", () => {
  it("returns our own HttpErrors unchanged as JSON", async () => {
    const response = providerErrorResponse(new HttpError("Nope", 403), "X")

    expect(response.status).toBe(403)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(await response.json()).toEqual({ message: "Nope" })
  })
})

describe("readJsonBody", () => {
  it("throws a 400 HttpError for malformed JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "{"
    })

    await expect(readJsonBody(request)).rejects.toMatchObject({
      status: 400,
      message: "Request body must be valid JSON"
    })
  })
})
