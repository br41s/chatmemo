import { Tables } from "@/supabase/types"
import { VALID_ENV_KEYS } from "@/types/valid-keys"
import OpenAI from "openai"

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
const AZURE_API_VERSION = "2023-12-01-preview"
const AZURE_OPENAI_HOST_SUFFIX = ".openai.azure.com"

type EmbeddingProfile = Pick<
  Tables<"profiles">,
  | "azure_openai_api_key"
  | "azure_openai_embeddings_id"
  | "azure_openai_endpoint"
  | "openai_api_key"
  | "openai_organization_id"
  | "use_azure_openai"
>

export class EmbeddingRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "EmbeddingRequestError"
    this.status = status
  }
}

function requireValue(value: string | null, name: string) {
  if (!value) {
    throw new EmbeddingRequestError(`${name} not found`, 400)
  }
  return value
}

export function normalizeAzureOpenAIEndpoint(rawEndpoint: string | null) {
  const endpoint = requireValue(rawEndpoint, "Azure OpenAI endpoint")
  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    throw new EmbeddingRequestError("Azure OpenAI endpoint is invalid", 400)
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    hostname.endsWith(".") ||
    !hostname.endsWith(AZURE_OPENAI_HOST_SUFFIX) ||
    hostname.length <= AZURE_OPENAI_HOST_SUFFIX.length
  ) {
    throw new EmbeddingRequestError(
      "Azure OpenAI endpoint must be an HTTPS openai.azure.com resource origin",
      400
    )
  }

  return url.origin
}

function createEmbeddingClient(profile: EmbeddingProfile) {
  if (!profile.use_azure_openai) {
    return new OpenAI({
      apiKey: requireValue(profile.openai_api_key, "OpenAI API Key"),
      organization: profile.openai_organization_id
    })
  }

  const azureEnvironmentValues = [
    process.env[VALID_ENV_KEYS.AZURE_OPENAI_API_KEY],
    process.env[VALID_ENV_KEYS.AZURE_OPENAI_ENDPOINT],
    process.env[VALID_ENV_KEYS.AZURE_EMBEDDINGS_NAME]
  ]
  if (
    azureEnvironmentValues.some(Boolean) &&
    !azureEnvironmentValues.every(Boolean)
  ) {
    throw new EmbeddingRequestError(
      "Azure OpenAI environment credentials require an environment endpoint and embeddings deployment",
      500
    )
  }

  const endpoint = normalizeAzureOpenAIEndpoint(profile.azure_openai_endpoint)
  const deployment = requireValue(
    profile.azure_openai_embeddings_id,
    "Azure OpenAI embeddings deployment"
  )

  return new OpenAI({
    apiKey: requireValue(profile.azure_openai_api_key, "Azure OpenAI API Key"),
    baseURL: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}`,
    defaultQuery: { "api-version": AZURE_API_VERSION },
    defaultHeaders: { "api-key": profile.azure_openai_api_key }
  })
}

export async function generateOpenAIEmbeddings(
  profile: EmbeddingProfile,
  input: string | string[],
  signal?: AbortSignal
) {
  const client = createEmbeddingClient(profile)
  const response = await client.embeddings.create(
    { model: OPENAI_EMBEDDING_MODEL, input },
    { signal }
  )
  const expectedCount = Array.isArray(input) ? input.length : 1

  const embeddings: unknown[][] = new Array(expectedCount)
  for (const item of response.data) {
    if (
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index >= expectedCount ||
      embeddings[item.index] !== undefined
    ) {
      throw new EmbeddingRequestError(
        "Embedding provider returned invalid result indexes",
        502
      )
    }
    embeddings[item.index] = item.embedding
  }

  if (
    response.data.length !== expectedCount ||
    embeddings.some(embedding => embedding === undefined)
  ) {
    throw new EmbeddingRequestError(
      "Embedding provider returned an unexpected result count",
      502
    )
  }

  return embeddings
}
