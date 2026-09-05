"use client"

import { MemoryReport } from "@/lib/memory-report"
import { ChatInputProvider } from "@/context/chat-input-context"
import { ChatStreamProvider } from "@/context/chat-stream-context"
import { ChatbotUIContext } from "@/context/context"
import { getWorkspaceImageFromStorage } from "@/db/storage/workspace-images"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import {
  fetchHostedModels,
  fetchOllamaModels,
  fetchOpenRouterModels
} from "@/lib/models/fetch-models"
import { InitialData } from "@/lib/server/initial-data"
import { Tables } from "@/supabase/types"
import {
  ChatFile,
  ChatMessage,
  ChatSettings,
  LLM,
  LLMID,
  MessageImage,
  OpenRouterLLM,
  WorkspaceImage
} from "@/types"
import { AssistantImage } from "@/types/images/assistant-image"
import { VALID_ENV_KEYS } from "@/types/valid-keys"
import { useRouter } from "next/navigation"
import { FC, useEffect, useState } from "react"

interface GlobalStateProps {
  children: React.ReactNode
  /**
   * Read on the server by the layout above (ARCH-11). Absent only for a user
   * with no readable profile, which is the same state a signed-out visitor
   * renders in.
   */
  initialData?: InitialData
}

export const GlobalState: FC<GlobalStateProps> = ({
  children,
  initialData
}) => {
  const router = useRouter()

  // PROFILE STORE
  //
  // Seeded rather than fetched: these two arrive with the request, so the
  // first render — server included — already has them, instead of every
  // surface that reads the profile waiting two round trips for it.
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(
    initialData?.profile ?? null
  )

  // ITEMS STORE
  const [assistants, setAssistants] = useState<Tables<"assistants">[]>([])
  const [collections, setCollections] = useState<Tables<"collections">[]>([])
  const [chats, setChats] = useState<Tables<"chats">[]>([])
  const [files, setFiles] = useState<Tables<"files">[]>([])
  const [folders, setFolders] = useState<Tables<"folders">[]>([])
  const [models, setModels] = useState<Tables<"models">[]>([])
  const [presets, setPresets] = useState<Tables<"presets">[]>([])
  const [prompts, setPrompts] = useState<Tables<"prompts">[]>([])
  const [tools, setTools] = useState<Tables<"tools">[]>([])
  const [workspaces, setWorkspaces] = useState<Tables<"workspaces">[]>(
    initialData?.workspaces ?? []
  )

  // MODELS STORE
  const [envKeyMap, setEnvKeyMap] = useState<Record<string, VALID_ENV_KEYS>>({})
  const [availableHostedModels, setAvailableHostedModels] = useState<LLM[]>([])
  const [availableLocalModels, setAvailableLocalModels] = useState<LLM[]>([])
  const [availableOpenRouterModels, setAvailableOpenRouterModels] = useState<
    OpenRouterLLM[]
  >([])

  // WORKSPACE STORE
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Tables<"workspaces"> | null>(null)
  const [workspaceImages, setWorkspaceImages] = useState<WorkspaceImage[]>([])

  // PRESET STORE
  const [selectedPreset, setSelectedPreset] =
    useState<Tables<"presets"> | null>(null)

  // ASSISTANT STORE
  const [selectedAssistant, setSelectedAssistant] =
    useState<Tables<"assistants"> | null>(null)
  const [assistantImages, setAssistantImages] = useState<AssistantImage[]>([])
  const [openaiAssistants, setOpenaiAssistants] = useState<any[]>([])

  // PASSIVE CHAT STORE
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    model: ((typeof window !== "undefined" &&
      localStorage.getItem("chatmemo.selectedModel")) ||
      "openai/gpt-4o-mini") as LLMID,
    prompt: "You are a helpful AI assistant.",
    temperature: 0.5,
    contextLength: 4000,
    includeProfileContext: true,
    includeWorkspaceInstructions: true,
    embeddingsProvider: "openai"
  })

  useEffect(() => {
    if (chatSettings.model) {
      localStorage.setItem("chatmemo.selectedModel", chatSettings.model)
    }
  }, [chatSettings.model])
  const [selectedChat, setSelectedChat] = useState<Tables<"chats"> | null>(null)
  const [chatFileItems, setChatFileItems] = useState<Tables<"file_items">[]>([])

  // ATTACHMENTS STORE
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([])
  const [chatImages, setChatImages] = useState<MessageImage[]>([])
  const [newMessageFiles, setNewMessageFiles] = useState<ChatFile[]>([])
  const [newMessageImages, setNewMessageImages] = useState<MessageImage[]>([])
  const [showFilesDisplay, setShowFilesDisplay] = useState<boolean>(false)

  // RETIEVAL STORE
  const [useRetrieval, setUseRetrieval] = useState<boolean>(true)
  const [sourceCount, setSourceCount] = useState<number>(4)

  // TOOL STORE
  const [selectedTools, setSelectedTools] = useState<Tables<"tools">[]>([])

  // MEMORY STORE
  const [memoryReports, setMemoryReports] = useState<
    Record<string, MemoryReport>
  >({})

  // What is left to do in the browser once the profile and the workspaces
  // arrive with the request: send a user who has not finished signup to setup,
  // then load the two things the server cannot — the workspace avatars, and
  // the model catalogues, which depend on the user's keys and on Ollama, which
  // runs on the user's own machine.
  //
  // These two used to be the tail of one serial chain behind the profile
  // fetch. They are independent of each other, so they go out together.
  useEffect(() => {
    if (!profile) return

    if (!profile.has_onboarded) {
      router.push("/setup")
      return
    }

    let cancelled = false

    const loadWorkspaceImages = async () => {
      // One write at the end rather than one per workspace. The old loop
      // awaited each image in turn and appended to state each time, so N
      // workspaces meant N sequential round trips and N re-renders.
      const images = await Promise.all(
        workspaces.map(async workspace => {
          if (!workspace.image_path) return null

          try {
            const url =
              (await getWorkspaceImageFromStorage(workspace.image_path)) || ""
            if (!url) return null

            const response = await fetch(url)
            const blob = await response.blob()
            const base64 = await convertBlobToBase64(blob)

            return {
              workspaceId: workspace.id,
              path: workspace.image_path,
              base64,
              url
            }
          } catch {
            // An avatar that will not load is not worth a missing switcher.
            return null
          }
        })
      )

      if (!cancelled) {
        setWorkspaceImages(
          images.filter((image): image is WorkspaceImage => image !== null)
        )
      }
    }

    const loadModels = async () => {
      const hostedModelRes = await fetchHostedModels(profile)
      // Don't bail — use empty defaults so the rest of init still runs
      const envKeyMap = hostedModelRes?.envKeyMap ?? {}
      const hostedModels = hostedModelRes?.hostedModels ?? []

      if (cancelled) return

      setEnvKeyMap(envKeyMap)
      setAvailableHostedModels(hostedModels)

      if (profile["openrouter_api_key"] || envKeyMap["openrouter"]) {
        const openRouterModels = await fetchOpenRouterModels()
        if (openRouterModels && !cancelled) {
          setAvailableOpenRouterModels(openRouterModels)
        }
      }
    }

    const loadLocalModels = async () => {
      if (!process.env.NEXT_PUBLIC_OLLAMA_URL) return

      const localModels = await fetchOllamaModels()
      if (localModels && !cancelled) {
        setAvailableLocalModels(localModels)
      }
    }

    void Promise.all([loadWorkspaceImages(), loadModels(), loadLocalModels()])

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ChatbotUIContext.Provider
      value={{
        // PROFILE STORE
        profile,
        setProfile,

        // ITEMS STORE
        assistants,
        setAssistants,
        collections,
        setCollections,
        chats,
        setChats,
        files,
        setFiles,
        folders,
        setFolders,
        models,
        setModels,
        presets,
        setPresets,
        prompts,
        setPrompts,
        tools,
        setTools,
        workspaces,
        setWorkspaces,

        // MODELS STORE
        envKeyMap,
        setEnvKeyMap,
        availableHostedModels,
        setAvailableHostedModels,
        availableLocalModels,
        setAvailableLocalModels,
        availableOpenRouterModels,
        setAvailableOpenRouterModels,

        // WORKSPACE STORE
        selectedWorkspace,
        setSelectedWorkspace,
        workspaceImages,
        setWorkspaceImages,

        // PRESET STORE
        selectedPreset,
        setSelectedPreset,

        // ASSISTANT STORE
        selectedAssistant,
        setSelectedAssistant,
        assistantImages,
        setAssistantImages,
        openaiAssistants,
        setOpenaiAssistants,

        // PASSIVE CHAT STORE
        chatSettings,
        setChatSettings,
        selectedChat,
        setSelectedChat,
        chatFileItems,
        setChatFileItems,

        // ATTACHMENT STORE
        chatFiles,
        setChatFiles,
        chatImages,
        setChatImages,
        newMessageFiles,
        setNewMessageFiles,
        newMessageImages,
        setNewMessageImages,
        showFilesDisplay,
        setShowFilesDisplay,

        // RETRIEVAL STORE
        useRetrieval,
        setUseRetrieval,
        sourceCount,
        setSourceCount,

        // TOOL STORE
        selectedTools,
        setSelectedTools,

        // MEMORY STORE
        memoryReports,
        setMemoryReports
      }}
    >
      {/* Inside, so a token or a keystroke re-renders only what reads them —
          this component, and therefore the value object above, stays put. */}
      <ChatStreamProvider>
        <ChatInputProvider>{children}</ChatInputProvider>
      </ChatStreamProvider>
    </ChatbotUIContext.Provider>
  )
}
