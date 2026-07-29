import {
  isShareableToolConfig,
  isShareableToolSchema,
  isShareableToolUrl
} from "@/lib/tool-sharing"

describe("shared tool configuration", () => {
  it.each(["", "https://api.example.com", "https://api.example.com/v1"])(
    "accepts a public URL without embedded values: %s",
    url => {
      expect(isShareableToolUrl(url)).toBe(true)
    }
  )

  it.each([
    "http://api.example.com",
    "https://user:password@api.example.com",
    "https://api.example.com?api_key=secret",
    "https://api.example.com?subscription-key=secret",
    "https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz",
    "https://hooks.zapier.com/hooks/catch/123456/abcdefghijklmnop",
    "https://api.example.com#token"
  ])("rejects a stored URL that is not safe to share: %s", url => {
    expect(isShareableToolUrl(url)).toBe(false)
  })

  it("accepts an unauthenticated OpenAPI schema", () => {
    expect(
      isShareableToolSchema({
        openapi: "3.1.0",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/weather": {
            get: {
              operationId: "getWeather",
              parameters: [{ name: "city", in: "query" }]
            }
          }
        }
      })
    ).toBe(true)
  })

  it.each([
    { authorization: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { apiKey: { default: "plain-secret-value", type: "string" } },
    { description: "Example: Bearer abcdefghijklmnopqrstuvwxyz==" },
    { example: "sk-abcdefghijklmnopqrstuvwxyz" },
    { servers: [{ url: "https://api.example.com?format=json" }] },
    {
      servers: [
        {
          url: "https://hooks.zapier.com/hooks/catch/123456/abcdefghijklmnop"
        }
      ]
    },
    { servers: [{ url: "https://api.example.com?access_token=secret" }] },
    { servers: [{ url: "https://api.example.com#embedded-value" }] },
    {
      parameters: [{ name: "X-API-Key", in: "header", schema: { type: "string" } }]
    },
    {
      parameters: [
        {
          name: "Ocp-Apim-Subscription-Key",
          in: "header",
          schema: { type: "string" }
        }
      ]
    },
    { security: [{ BearerAuth: [] }] },
    { components: { securitySchemes: { BearerAuth: { type: "http" } } } }
  ])("rejects credential-bearing schema %#", schema => {
    expect(isShareableToolSchema(schema)).toBe(false)
  })

  it("rejects malformed serialized schemas", () => {
    expect(isShareableToolSchema("not-json")).toBe(false)
  })

  // tool_schema_contains_credentials returns true for any non-object jsonb, so
  // the app must reject the same shapes or it would call a tool shareable that
  // the CHECK constraint and the RLS policy both refuse.
  it.each([42, true, null, "42", "[]", [], [{ name: "city", in: "query" }]])(
    "rejects a schema that is not a JSON object: %p",
    schema => {
      expect(isShareableToolSchema(schema)).toBe(false)
    }
  )

  it("requires both schema and URL to be shareable", () => {
    expect(
      isShareableToolConfig(
        { servers: [{ url: "https://api.example.com" }] },
        "https://api.example.com?token=secret"
      )
    ).toBe(false)
  })
})
