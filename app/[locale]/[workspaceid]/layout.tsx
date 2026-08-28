"use client"

import { Dashboard } from "@/components/ui/dashboard"
import { useChatStream } from "@/context/chat-stream-context"
import { useChatInput } from "@/context/chat-input-context"
import { ChatbotUIContext } from "@/context/context"
import { getAssistantWorkspacesByWorkspaceId } from "@/db/assistants"
import { getChatsByWorkspaceId } from "@/db/chats"
import { getCollectionWorkspacesByWorkspaceId } from "@/db/collections"
import { getFileWorkspacesByWorkspaceId } from "@/db/files"
import { getFoldersByWorkspaceId } from "@/db/folders"
import { getModelWorkspacesByWorkspaceId } from "@/db/models"
import { getPresetWorkspacesByWorkspaceId } from "@/db/presets"
import { getPromptWorkspacesByWorkspaceId } from "@/db/prompts"
import { getAssistantImageFromStorage } from "@/db/storage/assistant-images"
import { getToolWorkspacesByWorkspaceId } from "@/db/tools"
import { getWorkspaceById } from "@/db/workspaces"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import { supabase } from "@/lib/supabase/browser-client"
import { Tables } from "@/supabase/types"
import { LLMID } from "@/types"
import { AssistantImage } from "@/types/images/assistant-image"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ReactNode, useContext, useEffect, useState } from "react"
import Loading from "../loading"

interface WorkspaceLayoutProps {
  children: ReactNode
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const router = useRouter()

  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceid as string

  const {
    setChatSettings,
    setAssistants,
    setAssistantImages,
    setChats,
    setCollections,
    setFolders,
    setFiles,
    setPresets,
    setPrompts,
    setTools,
    setModels,
    selectedWorkspace,
    setSelectedWorkspace,
    setSelectedChat,
    setChatFiles,
    setChatImages,
    setNewMessageFiles,
    setNewMessageImages,
    setShowFilesDisplay
  } = useContext(ChatbotUIContext)

  const { setChatMessages, setIsGenerating, setFirstTokenReceived } =
    useChatStream()

  const { setUserInput } = useChatInput()

  const [loading, setLoading] = useState(true)

  // One effect, keyed on the workspace. There used to be a second mount-only
  // effect that checked the session and then fetched as well, so a first load
  // ran the whole fetch twice concurrently.
  useEffect(() => {
    setUserInput("")
    setChatMessages([])
    setSelectedChat(null)

    setIsGenerating(false)
    setFirstTokenReceived(false)

    setChatFiles([])
    setChatImages([])
    setNewMessageFiles([])
    setNewMessageImages([])
    setShowFilesDisplay(false)
    ;(async () => {
      const session = (await supabase.auth.getSession()).data.session

      if (!session) {
        router.push("/login")
        return
      }

      await fetchWorkspaceData(workspaceId)
    })()
  }, [workspaceId])

  // Load one assistant's avatar. Returns an entry either way so the caller can
  // replace the whole list in one write — a missing image is still a known
  // answer for that assistant, not an absence.
  const loadAssistantImage = async (
    assistant: Tables<"assistants">
  ): Promise<AssistantImage> => {
    const url = assistant.image_path
      ? (await getAssistantImageFromStorage(assistant.image_path)) || ""
      : ""

    if (!url) {
      return {
        assistantId: assistant.id,
        path: assistant.image_path,
        base64: "",
        url
      }
    }

    const response = await fetch(url)
    const blob = await response.blob()
    const base64 = await convertBlobToBase64(blob)

    return {
      assistantId: assistant.id,
      path: assistant.image_path,
      base64,
      url
    }
  }

  const fetchWorkspaceData = async (workspaceId: string) => {
    setLoading(true)

    // These ten reads are independent of each other, so they go out together
    // instead of as a ten-deep waterfall behind a full-page spinner.
    const [
      workspace,
      assistantData,
      chats,
      collectionData,
      folders,
      fileData,
      presetData,
      promptData,
      toolData,
      modelData
    ] = await Promise.all([
      getWorkspaceById(workspaceId),
      getAssistantWorkspacesByWorkspaceId(workspaceId),
      getChatsByWorkspaceId(workspaceId),
      getCollectionWorkspacesByWorkspaceId(workspaceId),
      getFoldersByWorkspaceId(workspaceId),
      getFileWorkspacesByWorkspaceId(workspaceId),
      getPresetWorkspacesByWorkspaceId(workspaceId),
      getPromptWorkspacesByWorkspaceId(workspaceId),
      getToolWorkspacesByWorkspaceId(workspaceId),
      getModelWorkspacesByWorkspaceId(workspaceId)
    ])

    setSelectedWorkspace(workspace)
    setAssistants(assistantData.assistants)
    setChats(chats)
    setCollections(collectionData.collections)
    setFolders(folders)
    setFiles(fileData.files)
    setPresets(presetData.presets)
    setPrompts(promptData.prompts)
    setTools(toolData.tools)
    setModels(modelData.models)

    // Replace rather than append. Appending accumulated a duplicate entry per
    // assistant on every workspace switch, and two per assistant on first load
    // back when the fetch ran twice.
    setAssistantImages(
      await Promise.all(assistantData.assistants.map(loadAssistantImage))
    )

    setChatSettings({
      model: (searchParams.get("model") ||
        localStorage.getItem("chatmemo.selectedModel") ||
        workspace?.default_model ||
        "openai/gpt-4o-mini") as LLMID,
      prompt:
        workspace?.default_prompt ||
        "You are a friendly, helpful AI assistant.",
      temperature: workspace?.default_temperature || 0.5,
      contextLength: workspace?.default_context_length || 4096,
      includeProfileContext: workspace?.include_profile_context || true,
      includeWorkspaceInstructions:
        workspace?.include_workspace_instructions || true,
      embeddingsProvider:
        (workspace?.embeddings_provider as "openai" | "local") || "openai"
    })

    setLoading(false)
  }

  if (loading) {
    return <Loading />
  }

  return <Dashboard>{children}</Dashboard>
}
