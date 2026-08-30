import { Tables, TablesUpdate } from "@/supabase/types"
import { PROFILE_USERNAME_MAX, PROFILE_USERNAME_MIN } from "@/db/limits"

// The settings form as data.
//
// It was twenty-three `useState` hooks in one 745-line component, sixteen of
// them API keys that differ only by which profile column they write to — and a
// save that restated every one of them by hand, so adding a provider meant
// touching four places and forgetting one was silent.

export interface ProfileFormValues {
  displayName: string
  username: string
  profileInstructions: string
  useAzureOpenai: boolean
  openaiAPIKey: string
  openaiOrgID: string
  azureOpenaiAPIKey: string
  azureOpenaiEndpoint: string
  azureOpenai35TurboID: string
  azureOpenai45TurboID: string
  azureOpenai45VisionID: string
  azureEmbeddingsID: string
  anthropicAPIKey: string
  googleGeminiAPIKey: string
  mistralAPIKey: string
  groqAPIKey: string
  perplexityAPIKey: string
  openrouterAPIKey: string
}

export function profileFormValues(
  profile: Tables<"profiles"> | null
): ProfileFormValues {
  return {
    displayName: profile?.display_name || "",
    username: profile?.username || "",
    profileInstructions: profile?.profile_context || "",
    useAzureOpenai: profile?.use_azure_openai || false,
    openaiAPIKey: profile?.openai_api_key || "",
    openaiOrgID: profile?.openai_organization_id || "",
    azureOpenaiAPIKey: profile?.azure_openai_api_key || "",
    azureOpenaiEndpoint: profile?.azure_openai_endpoint || "",
    azureOpenai35TurboID: profile?.azure_openai_35_turbo_id || "",
    azureOpenai45TurboID: profile?.azure_openai_45_turbo_id || "",
    azureOpenai45VisionID: profile?.azure_openai_45_vision_id || "",
    azureEmbeddingsID: profile?.azure_openai_embeddings_id || "",
    anthropicAPIKey: profile?.anthropic_api_key || "",
    googleGeminiAPIKey: profile?.google_gemini_api_key || "",
    mistralAPIKey: profile?.mistral_api_key || "",
    groqAPIKey: profile?.groq_api_key || "",
    perplexityAPIKey: profile?.perplexity_api_key || "",
    openrouterAPIKey: profile?.openrouter_api_key || ""
  }
}

/** The row update a save writes. */
export function profileUpdate(
  values: ProfileFormValues,
  image: { url: string | null; path: string }
): TablesUpdate<"profiles"> {
  return {
    display_name: values.displayName,
    username: values.username,
    profile_context: values.profileInstructions,
    image_url: image.url ?? "",
    image_path: image.path,
    use_azure_openai: values.useAzureOpenai,
    openai_api_key: values.openaiAPIKey,
    openai_organization_id: values.openaiOrgID,
    azure_openai_api_key: values.azureOpenaiAPIKey,
    azure_openai_endpoint: values.azureOpenaiEndpoint,
    azure_openai_35_turbo_id: values.azureOpenai35TurboID,
    azure_openai_45_turbo_id: values.azureOpenai45TurboID,
    azure_openai_45_vision_id: values.azureOpenai45VisionID,
    azure_openai_embeddings_id: values.azureEmbeddingsID,
    anthropic_api_key: values.anthropicAPIKey,
    google_gemini_api_key: values.googleGeminiAPIKey,
    mistral_api_key: values.mistralAPIKey,
    groq_api_key: values.groqAPIKey,
    perplexity_api_key: values.perplexityAPIKey,
    openrouter_api_key: values.openrouterAPIKey
  }
}

/**
 * Which profile column holds a provider's key.
 *
 * Two providers do not follow `<provider>_api_key`, and the save loop worked
 * that out inline. Getting it wrong here means a key that is set reads as
 * absent, and the provider's models silently vanish from the picker.
 */
export function providerProfileKey(provider: string): keyof Tables<"profiles"> {
  if (provider === "google") return "google_gemini_api_key"
  if (provider === "azure") return "azure_openai_api_key"

  return `${provider}_api_key` as keyof Tables<"profiles">
}

/** The provider keys that are a plain label and a password box. */
export const SIMPLE_KEY_FIELDS: {
  field: keyof ProfileFormValues
  envKey: string
  label: string
}[] = [
  { field: "anthropicAPIKey", envKey: "anthropic", label: "Anthropic API Key" },
  {
    field: "googleGeminiAPIKey",
    envKey: "google",
    label: "Google Gemini API Key"
  },
  { field: "mistralAPIKey", envKey: "mistral", label: "Mistral API Key" },
  { field: "groqAPIKey", envKey: "groq", label: "Groq API Key" },
  {
    field: "perplexityAPIKey",
    envKey: "perplexity",
    label: "Perplexity API Key"
  },
  {
    field: "openrouterAPIKey",
    envKey: "openrouter",
    label: "OpenRouter API Key"
  }
]

export interface UsernameCheck {
  valid: boolean
  /** Shown to the person; absent when the rule needs no explaining. */
  reason?: string
}

/**
 * Whether a username is worth asking the server about.
 *
 * Kept separate from the availability request so the rules can be read and
 * tested without a network round trip — and so a name that breaks one of them
 * never costs a request.
 */
export function validateUsername(username: string): UsernameCheck {
  if (username.length < PROFILE_USERNAME_MIN) return { valid: false }
  if (username.length > PROFILE_USERNAME_MAX) return { valid: false }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return {
      valid: false,
      reason:
        "Username must be letters, numbers, or underscores only - no other characters or spacing allowed."
    }
  }

  return { valid: true }
}
