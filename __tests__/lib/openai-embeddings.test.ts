/** @jest-environment node */

import {
  generateOpenAIEmbeddings,
  normalizeAzureOpenAIEndpoint
} from "../../lib/server/openai-embeddings"
import OpenAI from "openai"

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn()
}))

const mockOpenAI = jest.mocked(OpenAI)

function profile(overrides: Record<string, unknown> = {}) {
  return {
    azure_openai_api_key: "azure-key",
    azure_openai_embeddings_id: "embedding/deployment",
    azure_openai_endpoint: "https://resource.openai.azure.com",
    openai_api_key: "openai-key",
    openai_organization_id: "org-id",
    use_azure_openai: false,
    ...overrides
  } as any
}

describe("OpenAI embeddings", () => {
  const create = jest.fn()
  const originalAzureKey = process.env.AZURE_OPENAI_API_KEY
  const originalAzureEndpoint = process.env.AZURE_OPENAI_ENDPOINT
  const originalAzureEmbeddingsName = process.env.AZURE_EMBEDDINGS_NAME

  beforeEach(() => {
    jest.clearAllMocks()
    create.mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2] }] })
    mockOpenAI.mockImplementation(() => ({ embeddings: { create } }) as any)
  })

  afterEach(() => {
    if (originalAzureKey === undefined) delete process.env.AZURE_OPENAI_API_KEY
    else process.env.AZURE_OPENAI_API_KEY = originalAzureKey
    if (originalAzureEndpoint === undefined)
      delete process.env.AZURE_OPENAI_ENDPOINT
    else process.env.AZURE_OPENAI_ENDPOINT = originalAzureEndpoint
    if (originalAzureEmbeddingsName === undefined)
      delete process.env.AZURE_EMBEDDINGS_NAME
    else process.env.AZURE_EMBEDDINGS_NAME = originalAzureEmbeddingsName
  })

  it("passes the request signal to standard OpenAI", async () => {
    const controller = new AbortController()

    await expect(
      generateOpenAIEmbeddings(profile(), "hello", controller.signal)
    ).resolves.toEqual([[0.1, 0.2]])

    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "openai-key",
      organization: "org-id"
    })
    expect(create).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: "hello" },
      { signal: controller.signal }
    )
  })

  it("accepts only documented Azure OpenAI resource origins", () => {
    expect(
      normalizeAzureOpenAIEndpoint("https://resource.openai.azure.com/")
    ).toBe("https://resource.openai.azure.com")

    for (const endpoint of [
      "http://resource.openai.azure.com",
      "https://openai.azure.com",
      "https://resource.openai.azure.com.attacker.test",
      "https://127.0.0.1",
      "https://resource.openai.azure.com/path",
      "https://resource.openai.azure.com?redirect=internal"
    ]) {
      expect(() => normalizeAzureOpenAIEndpoint(endpoint)).toThrow(
        "Azure OpenAI endpoint must be"
      )
    }
  })

  it("encodes the Azure deployment as one path segment", async () => {
    await generateOpenAIEmbeddings(profile({ use_azure_openai: true }), "hello")

    expect(mockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "azure-key",
        baseURL:
          "https://resource.openai.azure.com/openai/deployments/embedding%2Fdeployment"
      })
    )
  })

  it.each([
    ["server-key", undefined, undefined],
    ["server-key", "https://server.openai.azure.com", undefined],
    ["server-key", undefined, "server-deployment"],
    [undefined, "https://server.openai.azure.com", undefined],
    [undefined, undefined, "server-deployment"]
  ])(
    "rejects any partial Azure environment configuration",
    async (key, endpoint, deployment) => {
      if (key) process.env.AZURE_OPENAI_API_KEY = key
      else delete process.env.AZURE_OPENAI_API_KEY
      if (endpoint) process.env.AZURE_OPENAI_ENDPOINT = endpoint
      else delete process.env.AZURE_OPENAI_ENDPOINT
      if (deployment) process.env.AZURE_EMBEDDINGS_NAME = deployment
      else delete process.env.AZURE_EMBEDDINGS_NAME

      await expect(
        generateOpenAIEmbeddings(profile({ use_azure_openai: true }), "hello")
      ).rejects.toMatchObject({ status: 500 })
      expect(mockOpenAI).not.toHaveBeenCalled()
    }
  )

  it("rejects incomplete embedding responses", async () => {
    create.mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] })

    await expect(
      generateOpenAIEmbeddings(profile(), ["first", "second"])
    ).rejects.toMatchObject({ status: 502 })
  })

  it("restores provider results to their requested input order", async () => {
    create.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2] },
        { index: 0, embedding: [0.1] }
      ]
    })

    await expect(
      generateOpenAIEmbeddings(profile(), ["first", "second"])
    ).resolves.toEqual([[0.1], [0.2]])
  })

  it("rejects duplicate or out-of-range provider indexes", async () => {
    for (const data of [
      [
        { index: 0, embedding: [0.1] },
        { index: 0, embedding: [0.2] }
      ],
      [
        { index: 0, embedding: [0.1] },
        { index: 2, embedding: [0.2] }
      ]
    ]) {
      create.mockResolvedValueOnce({ data })
      await expect(
        generateOpenAIEmbeddings(profile(), ["first", "second"])
      ).rejects.toMatchObject({ status: 502 })
    }
  })
})
