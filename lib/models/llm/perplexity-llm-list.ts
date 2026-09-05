import { LLM } from "@/types"

const PERPLEXITY_PLATORM_LINK =
  "https://docs.perplexity.ai/docs/getting-started"

// Perplexity Models (UPDATED 2/25/24) -----------------------------
//
// Do not trust this list. It is the February 2024 lineup and has not been
// verified since; the deprecation notice below is itself from that period and
// names models that were removed years ago.
//
// Every other provider's catalogue is now fetched from the provider (ARCH-07,
// `app/api/models`). Perplexity publishes no documented models endpoint, so it
// is asked on the OpenAI-compatible path and falls back to this file when that
// does not answer — which makes this the one static list that can still put a
// dead model in the picker.
//
// It stays because deleting a provider is a product decision, and it is inert
// in practice: a provider only reaches the picker when the user holds a key
// for it, and Perplexity is reached through OpenRouter instead, whose
// catalogue does self-update. Refresh this from a live key before relying on
// it, or remove the direct integration.
//
// Original notice, kept for the date it carries:
// Please note that on March 15, the pplx-70b-chat, pplx-70b-online, llama-2-70b-chat, and codellama-34b-instruct models will no longer be available through the Perplexity API.

// Mixtral 8x7B Instruct (UPDATED 1/31/24)
const MIXTRAL_8X7B_INSTRUCT: LLM = {
  modelId: "mixtral-8x7b-instruct",
  modelName: "Mixtral 8x7B Instruct",
  provider: "perplexity",
  hostedId: "mixtral-8x7b-instruct",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// Mistral 7B Instruct (UPDATED 1/31/24)
const MISTRAL_7B_INSTRUCT: LLM = {
  modelId: "mistral-7b-instruct",
  modelName: "Mistral 7B Instruct",
  provider: "perplexity",
  hostedId: "mistral-7b-instruct",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// CodeLlama 70B Instruct (UPDATED 1/31/24)
const CODELLAMA_70B_INSTRUCT: LLM = {
  modelId: "codellama-70b-instruct",
  modelName: "CodeLlama 70B Instruct",
  provider: "perplexity",
  hostedId: "codellama-70b-instruct",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// Sonar Small Chat (UPDATED 2/25/24)
const PERPLEXITY_SONAR_SMALL_CHAT_7B: LLM = {
  modelId: "sonar-small-chat",
  modelName: "Sonar Small Chat",
  provider: "perplexity",
  hostedId: "sonar-small-chat",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// Sonar Small Online (UPDATED 2/25/24)
const PERPLEXITY_SONAR_SMALL_ONLINE_7B: LLM = {
  modelId: "sonar-small-online",
  modelName: "Sonar Small Online",
  provider: "perplexity",
  hostedId: "sonar-small-online",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// Sonar Medium Chat (UPDATED 2/25/24)
const PERPLEXITY_SONAR_MEDIUM_CHAT_8x7B: LLM = {
  modelId: "sonar-medium-chat",
  modelName: "Sonar Medium Chat",
  provider: "perplexity",
  hostedId: "sonar-medium-chat",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

// Sonar Medium Online (UPDATED 2/25/24)
const PERPLEXITY_SONAR_MEDIUM_ONLINE_8x7B: LLM = {
  modelId: "sonar-medium-online",
  modelName: "Sonar Medium Online",
  provider: "perplexity",
  hostedId: "sonar-medium-online",
  platformLink: PERPLEXITY_PLATORM_LINK,
  imageInput: false
}

export const PERPLEXITY_LLM_LIST: LLM[] = [
  MIXTRAL_8X7B_INSTRUCT,
  MISTRAL_7B_INSTRUCT,
  CODELLAMA_70B_INSTRUCT,
  PERPLEXITY_SONAR_SMALL_CHAT_7B,
  PERPLEXITY_SONAR_SMALL_ONLINE_7B,
  PERPLEXITY_SONAR_MEDIUM_CHAT_8x7B,
  PERPLEXITY_SONAR_MEDIUM_ONLINE_8x7B
]
