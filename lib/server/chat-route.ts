import { ContextBudgetHint } from "@/lib/context-budget"
import {
  injectMemoryGoogleFormat,
  injectMemoryOpenAIFormat
} from "@/lib/server/inject-memory"
import { memoryReportHeaders } from "@/lib/server/memory-report-headers"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { ChatSettings } from "@/types"

// Nine provider routes each repeated the same twenty-five lines: parse the body,
// load the profile, check the key, inject memory, call the model, stream the
// answer, and map two errors to two sentences. Seven were identical apart from a
// key field, a base URL and a product name — which is how one of them ended up
// telling people their "G API Key" was missing.
//
// What is left in each route file is only what actually differs between
// providers: which SDK, which message shape, and which fields that SDK takes.

/** The profile shape the routes see, with env-var keys already merged in. */
export type ChatProfile = Awaited<ReturnType<typeof getServerProfile>>

export interface ChatRouteContext {
  profile: ChatProfile
  chatSettings: ChatSettings
  /** The conversation with the memory block already prepended. */
  messages: any[]
  /** Memory-report headers to hand to the streaming response. */
  headers: Record<string, string>
}

/**
 * How a provider signals that a key is present but wrong.
 *
 * The routes disagreed about this and each guessed separately: OpenAI puts it
 * in the message, Google words it differently again, Groq and friends only
 * return a status, and OpenRouter's route never handled the case at all.
 */
export type IncorrectKeySignal =
  | { kind: "message"; contains: string }
  | { kind: "status"; status: number }
  | { kind: "none" }

export interface ChatRouteConfig {
  /** The name as it appears in the two key errors a person actually reads. */
  provider: string
  /** Where this provider's key lives on the profile. */
  apiKey: (profile: ChatProfile) => string | null
  /** Which message shape the model wants. Google is the only outlier. */
  format?: "openai" | "google"
  /** Defaults to a 401, which is what most of these SDKs return. */
  incorrectKey?: IncorrectKeySignal
  /**
   * Runs before any memory work. Returning a Response aborts the request with
   * it — for configuration that has to be resolved before a call is worth
   * making, like Azure's deployment id.
   */
  validate?: (
    profile: ChatProfile,
    chatSettings: ChatSettings
  ) => Response | undefined
  /** Call the model and return its stream. */
  respond: (context: ChatRouteContext) => Promise<Response>
}

const DEFAULT_INCORRECT_KEY: IncorrectKeySignal = {
  kind: "status",
  status: 401
}

/**
 * The message to show for a failed request.
 *
 * Both branches are about the key, because those are the two failures a person
 * can actually do something about. Everything else is passed through as the
 * provider worded it.
 */
export function chatErrorMessage(
  provider: string,
  error: any,
  incorrectKey: IncorrectKeySignal = DEFAULT_INCORRECT_KEY
): { message: string; status: number } {
  // Azure's SDK nests it; the rest put it on the error itself.
  const raw: string =
    error?.message || error?.error?.message || "An unexpected error occurred"
  const status: number = error?.status || 500
  const lower = raw.toLowerCase()

  if (lower.includes("api key not found")) {
    return {
      message: `${provider} API Key not found. Please set it in your profile settings.`,
      status
    }
  }

  const wrongKey =
    incorrectKey.kind === "message"
      ? lower.includes(incorrectKey.contains)
      : incorrectKey.kind === "status"
        ? status === incorrectKey.status
        : false

  if (wrongKey) {
    return {
      message: `${provider} API Key is incorrect. Please fix it in your profile settings.`,
      status
    }
  }

  return { message: raw, status }
}

function jsonResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), { status })
}

/**
 * Build a provider chat route.
 *
 * The envelope is fixed: a memory failure must never break the chat, which is
 * why injection happens through the shared injector rather than per route, and
 * why every route ends in the same error mapping.
 */
export function createChatRoute(config: ChatRouteConfig) {
  return async function POST(request: Request): Promise<Response> {
    const json = await request.json()
    const { chatSettings, messages, contextBudget } = json as {
      chatSettings: ChatSettings
      messages: any[]
      contextBudget?: ContextBudgetHint
    }

    try {
      const profile = await getServerProfile()

      checkApiKey(config.apiKey(profile), config.provider)

      const invalid = config.validate?.(profile, chatSettings)
      if (invalid) return invalid

      const inject =
        config.format === "google"
          ? injectMemoryGoogleFormat
          : injectMemoryOpenAIFormat

      const { messages: augmentedMessages, report } = await inject(
        messages,
        profile.user_id,
        contextBudget
      )

      return await config.respond({
        profile,
        chatSettings,
        messages: augmentedMessages,
        headers: memoryReportHeaders(report)
      })
    } catch (error: any) {
      const { message, status } = chatErrorMessage(
        config.provider,
        error,
        config.incorrectKey
      )

      return jsonResponse(message, status)
    }
  }
}
