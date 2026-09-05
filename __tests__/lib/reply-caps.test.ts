import {
  CHAT_SETTING_LIMITS,
  ChatSettingLimits
} from "../../lib/chat-setting-limits"
import { resolveContextBudget } from "../../lib/context-budget"
import { resolveModelWindow } from "../../lib/models/model-window"
import { LLMID } from "../../types"

// Every chat route now sizes the reply from the shared budget. Before that,
// three of them read `MAX_TOKEN_OUTPUT_LENGTH` straight out of the table, and
// for fifteen models in it that number *is* the whole context window —
// `llama3-8b-8192` asked for 8,192 of 8,192, which leaves nothing for the
// prompt the reply is supposed to be answering.

const capFor = (modelId: string) =>
  resolveContextBudget(resolveModelWindow(modelId)).outputTokens

const entries = Object.entries(CHAT_SETTING_LIMITS) as [
  LLMID,
  ChatSettingLimits
][]

describe("the reply never claims the whole window", () => {
  it.each(entries)("%s", (modelId, limits) => {
    const cap = capFor(modelId)

    expect(cap).toBeLessThanOrEqual(limits.MAX_CONTEXT_LENGTH * 0.25)
    expect(cap).toBeGreaterThan(0)
  })

  it("would have failed for fifteen models under the old table", () => {
    // Not a hypothetical: this is what those routes used to send.
    const wholeWindow = entries.filter(
      ([, limits]) =>
        limits.MAX_TOKEN_OUTPUT_LENGTH === limits.MAX_CONTEXT_LENGTH
    )

    expect(wholeWindow.length).toBe(15)
  })
})

describe("what the change actually moves", () => {
  // The three models reachable through the Groq route whose reply cap was the
  // entire window. These are the only behaviour changes in the app.
  it.each(["llama3-8b-8192", "llama3-70b-8192", "gemma-7b-it"])(
    "caps %s at 2048 rather than its whole 8192-token window",
    modelId => {
      expect(
        CHAT_SETTING_LIMITS[modelId as LLMID].MAX_TOKEN_OUTPUT_LENGTH
      ).toBe(8192)
      expect(capFor(modelId)).toBe(2048)
    }
  )

  it.each([
    ["claude-3-5-sonnet-20240620", 4096],
    ["claude-3-opus-20240229", 4096],
    ["mistral-large-latest", 2000],
    ["mistral-tiny", 2000],
    ["mixtral-8x7b-32768", 4096]
  ])("leaves %s exactly where it was, at %i", (modelId, expected) => {
    // Everything else on the three moved routes resolves to the number the
    // table already sent, so unifying them is not a change for these.
    expect(capFor(modelId as string)).toBe(expected)
    expect(CHAT_SETTING_LIMITS[modelId as LLMID].MAX_TOKEN_OUTPUT_LENGTH).toBe(
      expected
    )
  })
})

describe("an unknown model", () => {
  it("gets the conservative default rather than a guess", () => {
    // A model outside the table used to reach the routes through a helper that
    // fell back to 4096 regardless of the window. The budget clamps instead.
    expect(capFor("some-model-released-next-year")).toBe(2048)
  })
})
