import { CHAT_SETTING_LIMITS } from "../../lib/chat-setting-limits"
import { resolveContextBudget } from "../../lib/context-budget"
import { resolveModelWindow } from "../../lib/models/model-window"
import {
  CatalogModel,
  catalogForProvider,
  isOpenAIChatModel,
  mapAnthropicModels,
  mapGoogleModels,
  mapOpenAICompatibleModels
} from "../../lib/models/provider-catalog"
import { LLM } from "../../types"

const staticGroq: LLM[] = [
  {
    modelId: "llama3-8b-8192" as LLM["modelId"],
    modelName: "LLaMA3-8b",
    provider: "groq",
    hostedId: "llama3-8b-8192",
    platformLink: "https://groq.com/",
    imageInput: false,
    pricing: {
      currency: "USD",
      unit: "1M tokens",
      inputCost: 0.05,
      outputCost: 0.1
    }
  }
]

describe("mapOpenAICompatibleModels", () => {
  it("reads Groq's reported window and reply limit", () => {
    // Groq is the reason the live catalogue is worth fetching: it reports both
    // numbers the budget needs, for models the static table never heard of.
    const models = mapOpenAICompatibleModels(
      {
        object: "list",
        data: [
          {
            id: "llama-3.3-70b-versatile",
            object: "model",
            owned_by: "Meta",
            active: true,
            context_window: 131072,
            max_completion_tokens: 32768
          }
        ]
      },
      {
        provider: "groq",
        platformLink: "https://groq.com/",
        staticList: staticGroq
      }
    )

    expect(models).toEqual([
      {
        modelId: "llama-3.3-70b-versatile",
        modelName: "llama-3.3-70b-versatile",
        provider: "groq",
        hostedId: "llama-3.3-70b-versatile",
        platformLink: "https://groq.com/",
        imageInput: false,
        maxContext: 131072,
        maxOutput: 32768
      }
    ])
  })

  it("keeps the static name and pricing for a model it already knew", () => {
    // Providers do not report pricing, so the static list stays useful as a
    // hint even once it has stopped being the catalogue.
    const [model] = mapOpenAICompatibleModels(
      { data: [{ id: "llama3-8b-8192", context_window: 8192 }] },
      {
        provider: "groq",
        platformLink: "https://groq.com/",
        staticList: staticGroq
      }
    )

    expect(model.modelName).toBe("LLaMA3-8b")
    expect(model.pricing?.inputCost).toBe(0.05)
  })

  it("drops models the provider has retired but still lists", () => {
    const models = mapOpenAICompatibleModels(
      {
        data: [
          { id: "current-model", active: true },
          { id: "retired-model", active: false }
        ]
      },
      { provider: "groq", platformLink: "", staticList: [] }
    )

    expect(models.map(model => model.modelId)).toEqual(["current-model"])
  })

  it("reads Mistral's window and vision capability", () => {
    const [model] = mapOpenAICompatibleModels(
      {
        data: [
          {
            id: "pixtral-large-latest",
            max_context_length: 131072,
            capabilities: { completion_chat: true, vision: true }
          }
        ]
      },
      { provider: "mistral", platformLink: "", staticList: [] }
    )

    expect(model.maxContext).toBe(131072)
    expect(model.imageInput).toBe(true)
  })

  it("drops Mistral models that cannot serve a chat completion", () => {
    // Embedding and OCR models come back on the same endpoint.
    const models = mapOpenAICompatibleModels(
      {
        data: [
          { id: "mistral-embed", capabilities: { completion_chat: false } },
          {
            id: "mistral-large-latest",
            capabilities: { completion_chat: true }
          }
        ]
      },
      { provider: "mistral", platformLink: "", staticList: [] }
    )

    expect(models.map(model => model.modelId)).toEqual(["mistral-large-latest"])
  })

  it("returns nothing rather than throwing on an unexpected shape", () => {
    // A provider changing its response must not be able to break the picker.
    expect(
      mapOpenAICompatibleModels(null, {
        provider: "groq",
        platformLink: "",
        staticList: []
      })
    ).toEqual([])
    expect(
      mapOpenAICompatibleModels(
        { data: "not-an-array" },
        { provider: "groq", platformLink: "", staticList: [] }
      )
    ).toEqual([])
    expect(
      mapOpenAICompatibleModels(
        { data: [{ object: "model" }] },
        { provider: "groq", platformLink: "", staticList: [] }
      )
    ).toEqual([])
  })

  it("ignores a window the provider reports as zero or negative", () => {
    const [model] = mapOpenAICompatibleModels(
      { data: [{ id: "weird", context_window: 0, max_completion_tokens: -1 }] },
      { provider: "groq", platformLink: "", staticList: [] }
    )

    expect(model.maxContext).toBeUndefined()
    expect(model.maxOutput).toBeUndefined()
  })
})

describe("isOpenAIChatModel", () => {
  it("keeps chat families, including ones released after this was written", () => {
    expect(isOpenAIChatModel("gpt-4o")).toBe(true)
    expect(isOpenAIChatModel("gpt-6-turbo")).toBe(true)
    expect(isOpenAIChatModel("chatgpt-4o-latest")).toBe(true)
    expect(isOpenAIChatModel("o3-mini")).toBe(true)
  })

  it("drops everything that cannot serve a chat completion", () => {
    for (const id of [
      "text-embedding-3-large",
      "whisper-1",
      "tts-1-hd",
      "dall-e-3",
      "omni-moderation-latest",
      "gpt-3.5-turbo-instruct",
      "gpt-4o-realtime-preview",
      "gpt-4o-audio-preview",
      "babbage-002"
    ]) {
      expect(isOpenAIChatModel(id)).toBe(false)
    }
  })
})

describe("mapAnthropicModels", () => {
  it("uses the display name and reports no limits", () => {
    // Anthropic's endpoint carries no window, so the entry must not claim one:
    // the budget falls back to the table rather than to a guess.
    const [model] = mapAnthropicModels(
      { data: [{ type: "model", id: "claude-x", display_name: "Claude X" }] },
      [],
      "https://www.anthropic.com/"
    )

    expect(model.modelName).toBe("Claude X")
    expect(model.maxContext).toBeUndefined()
    expect(model.maxOutput).toBeUndefined()
  })

  it("survives a response with no data array", () => {
    expect(mapAnthropicModels({}, [], "")).toEqual([])
  })
})

describe("mapGoogleModels", () => {
  it("strips the models/ prefix and reads both limits", () => {
    const [model] = mapGoogleModels(
      {
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ["generateContent", "countTokens"]
          }
        ]
      },
      [],
      "https://ai.google.dev/"
    )

    expect(model.modelId).toBe("gemini-2.0-flash")
    expect(model.maxContext).toBe(1048576)
    expect(model.maxOutput).toBe(8192)
  })

  it("drops models that cannot generate content", () => {
    const models = mapGoogleModels(
      {
        models: [
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"]
          },
          {
            name: "models/gemini-2.0-flash",
            supportedGenerationMethods: ["generateContent"]
          }
        ]
      },
      [],
      ""
    )

    expect(models.map(model => model.modelId)).toEqual(["gemini-2.0-flash"])
  })
})

describe("catalogForProvider", () => {
  it("replaces the static list rather than merging into it", () => {
    // The retired IDs are the defect. Merging would keep claude-2.1 forever.
    const live: CatalogModel[] = [
      {
        modelId: "new-model" as LLM["modelId"],
        modelName: "New",
        provider: "groq",
        hostedId: "new-model",
        platformLink: "",
        imageInput: false
      }
    ]

    expect(catalogForProvider(live, staticGroq)).toEqual(live)
  })

  it("falls back to the static list when the provider said nothing usable", () => {
    expect(catalogForProvider(undefined, staticGroq)).toEqual(staticGroq)
    expect(catalogForProvider([], staticGroq)).toEqual(staticGroq)
  })
})

describe("resolveModelWindow with a live catalogue", () => {
  // `modelId` is widened deliberately: the whole point of a live catalogue is
  // serving models that are not in the `LLMID` union.
  const liveModel = (
    overrides: Omit<Partial<CatalogModel>, "modelId"> & { modelId: string }
  ): LLM =>
    ({
      modelName: overrides.modelId,
      provider: "groq",
      hostedId: overrides.modelId,
      platformLink: "",
      imageInput: false,
      ...overrides
    }) as LLM

  it("budgets a model the static table has never heard of", () => {
    // Before ARCH-07 this fell through to the 8192-token default, so a 131k
    // model was handed a fraction of its window.
    const hint = resolveModelWindow("llama-3.3-70b-versatile", [], null, [
      liveModel({
        modelId: "llama-3.3-70b-versatile",
        maxContext: 131072,
        maxOutput: 32768
      })
    ])

    expect(hint.windowTokens).toBe(131072)
    expect(hint.outputTokens).toBe(32768)
  })

  it("prefers what the provider reports over the frozen table", () => {
    const hint = resolveModelWindow("gpt-4", [], null, [
      liveModel({ modelId: "gpt-4", maxContext: 32768 })
    ])

    expect(hint.windowTokens).toBe(32768)
    expect(CHAT_SETTING_LIMITS["gpt-4"].MAX_CONTEXT_LENGTH).toBe(8192)
  })

  it("borrows the table's reply limit when the provider reports no output cap", () => {
    const hint = resolveModelWindow("gpt-4", [], null, [
      liveModel({ modelId: "gpt-4", maxContext: 32768 })
    ])

    expect(hint.outputTokens).toBe(
      CHAT_SETTING_LIMITS["gpt-4"].MAX_TOKEN_OUTPUT_LENGTH
    )
  })

  it("ignores a live entry that reports no window at all", () => {
    // Anthropic's catalogue has no limits in it, so a known model must keep
    // the table's 200k window rather than dropping to the default.
    const hint = resolveModelWindow("claude-3-5-sonnet-20240620", [], null, [
      liveModel({ modelId: "claude-3-5-sonnet-20240620" })
    ])

    expect(hint.windowTokens).toBe(200000)
  })

  it("still resolves a budget the memory layers can use", () => {
    const budget = resolveContextBudget(
      resolveModelWindow("llama-3.3-70b-versatile", [], null, [
        liveModel({
          modelId: "llama-3.3-70b-versatile",
          maxContext: 131072,
          maxOutput: 32768
        })
      ])
    )

    expect(budget.windowTokens).toBe(131072)
    // 32768 is exactly a quarter of the window, which is the cap, so it stands.
    expect(budget.outputTokens).toBe(32768)
    expect(budget.memoryChars).toBeGreaterThan(0)
  })
})
