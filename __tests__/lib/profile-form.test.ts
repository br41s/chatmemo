import { Tables } from "../../supabase/types"
import {
  profileFormValues,
  profileUpdate,
  providerProfileKey,
  SIMPLE_KEY_FIELDS,
  validateUsername
} from "../../lib/profile-form"

const savedProfile = {
  display_name: "Brais",
  username: "brais",
  profile_context: "Prefers short answers.",
  image_url: "https://example/avatar.png",
  use_azure_openai: true,
  openai_api_key: "sk-openai",
  openai_organization_id: "org-1",
  azure_openai_api_key: "az-key",
  azure_openai_endpoint: "https://az.openai.azure.com",
  azure_openai_35_turbo_id: "gpt35",
  azure_openai_45_turbo_id: "gpt45",
  azure_openai_45_vision_id: "gpt45v",
  azure_openai_embeddings_id: "embed",
  anthropic_api_key: "sk-ant",
  google_gemini_api_key: "goog",
  mistral_api_key: "mist",
  groq_api_key: "groq",
  perplexity_api_key: "pplx",
  openrouter_api_key: "or"
} as unknown as Tables<"profiles">

describe("profileFormValues", () => {
  it("reads every field off the profile", () => {
    const values = profileFormValues(savedProfile)

    expect(values.displayName).toBe("Brais")
    expect(values.useAzureOpenai).toBe(true)
    expect(values.azureOpenai45VisionID).toBe("gpt45v")
    expect(values.openrouterAPIKey).toBe("or")
  })

  it("gives empty strings for a profile that has not loaded", () => {
    const values = profileFormValues(null)

    expect(
      Object.values(values).every(value => value === "" || value === false)
    ).toBe(true)
  })
})

describe("profileUpdate", () => {
  it("writes back everything the form read", () => {
    // The guard that matters: a field added to the form but forgotten in the
    // save would silently never persist. A round trip catches it.
    const update = profileUpdate(profileFormValues(savedProfile), {
      url: savedProfile.image_url,
      path: "avatars/brais.png"
    })

    for (const [column, value] of Object.entries(savedProfile)) {
      if (column === "image_url") continue
      expect([column, update[column as keyof typeof update]]).toEqual([
        column,
        value
      ])
    }
  })

  it("carries the freshly uploaded image", () => {
    const update = profileUpdate(profileFormValues(savedProfile), {
      url: "https://example/new.png",
      path: "avatars/new.png"
    })

    expect(update.image_url).toBe("https://example/new.png")
    expect(update.image_path).toBe("avatars/new.png")
  })

  it("stores an empty string rather than null when there is no image", () => {
    const update = profileUpdate(profileFormValues(null), {
      url: null,
      path: ""
    })

    expect(update.image_url).toBe("")
  })
})

describe("providerProfileKey", () => {
  it("knows the two providers that do not follow the pattern", () => {
    // Getting these wrong means a key that is set reads as absent, and the
    // provider's models quietly vanish from the picker.
    expect(providerProfileKey("google")).toBe("google_gemini_api_key")
    expect(providerProfileKey("azure")).toBe("azure_openai_api_key")
  })

  it("derives the rest", () => {
    expect(providerProfileKey("anthropic")).toBe("anthropic_api_key")
    expect(providerProfileKey("groq")).toBe("groq_api_key")
    expect(providerProfileKey("openrouter")).toBe("openrouter_api_key")
  })

  it("names a real column for every simple key field", () => {
    for (const { envKey } of SIMPLE_KEY_FIELDS) {
      expect([envKey, providerProfileKey(envKey) in savedProfile]).toEqual([
        envKey,
        true
      ])
    }
  })
})

describe("validateUsername", () => {
  it("accepts a plain name", () => {
    expect(validateUsername("brais_01")).toEqual({ valid: true })
  })

  it("rejects one that is too short or too long, quietly", () => {
    // No reason given: the length is already on screen next to the field.
    expect(validateUsername("ab")).toEqual({ valid: false })
    expect(validateUsername("a".repeat(26))).toEqual({ valid: false })
  })

  it("explains the character rule, because nothing else does", () => {
    const result = validateUsername("brais lopez")

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/letters, numbers, or underscores/)
  })

  it("rejects the boundary cases on the right side", () => {
    expect(validateUsername("abc").valid).toBe(true)
    expect(validateUsername("a".repeat(25)).valid).toBe(true)
  })
})
