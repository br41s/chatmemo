"use client"

import { useChatInput } from "@/context/chat-input-context"
import { useChatStream } from "@/context/chat-stream-context"
import { ChatbotUIContext } from "@/context/context"
import { getAssistantImageFromStorage } from "@/db/storage/assistant-images"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import { WorkspaceData } from "@/lib/server/workspace-data"
import { Tables } from "@/supabase/types"
import { LLMID } from "@/types"
import { AssistantImage } from "@/types/images/assistant-image"
import { useSearchParams } from "next/navigation"
import { ReactNode, useContext, useEffect, useLayoutEffect } from "react"

// `useLayoutEffect` has no meaning on the server and React says so, loudly, for
// every client component rendered there. The seeding still wants to run before
// paint on the client, so pick per environment rather than downgrading it.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * Puts the server's workspace read into the client context (ARCH-11).
 *
 * The layout above this is now a server component, so by the time this runs
 * the data is already here — there is nothing to wait for and no spinner.
 * What is left is genuinely client work:
 *
 *   - seeding the context stores, in a layout effect so the values are in
 *     place before the browser paints rather than one frame after it;
 *   - resetting the per-chat state that must not survive a workspace switch;
 *   - the two chat settings only the browser knows: the `?model=` parameter
 *     and the last model chosen on this device;
 *   - assistant avatars, which are signed-URL fetches followed by a base64
 *     conversion, and are an enhancement rather than something to hold the
 *     first paint for.
 */
interface WorkspaceHydratorProps {
  data: WorkspaceData
  children: ReactNode
}

export function WorkspaceHydrator({ data, children }: WorkspaceHydratorProps) {
  const searchParams = useSearchParams()

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

  const workspaceId = data.workspace.id

  useIsomorphicLayoutEffect(() => {
    // Whatever was on screen belonged to the workspace being left.
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

    setSelectedWorkspace(data.workspace)
    setAssistants(data.assistants)
    setChats(data.chats)
    setCollections(data.collections)
    setFolders(data.folders)
    setFiles(data.files)
    setPresets(data.presets)
    setPrompts(data.prompts)
    setTools(data.tools)
    setModels(data.models)

    // `localStorage` and the query string are the two inputs the server cannot
    // see, so the model is settled here even though the rest is not.
    setChatSettings({
      model: (searchParams.get("model") ||
        localStorage.getItem("chatmemo.selectedModel") ||
        data.workspace.default_model ||
        "openai/gpt-4o-mini") as LLMID,
      prompt:
        data.workspace.default_prompt ||
        "You are a friendly, helpful AI assistant.",
      temperature: data.workspace.default_temperature ?? 0.5,
      contextLength: data.workspace.default_context_length ?? 4096,
      includeProfileContext: data.workspace.include_profile_context ?? true,
      includeWorkspaceInstructions:
        data.workspace.include_workspace_instructions ?? true,
      embeddingsProvider:
        (data.workspace.embeddings_provider as "openai" | "local") || "openai"
    })
    // Keyed on the workspace alone, as the client layout was. `data` is a new
    // object on every layout render, and re-running this on one of those would
    // clear the open conversation out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false

    // Replace rather than append: appending accumulated a duplicate entry per
    // assistant on every workspace switch.
    void Promise.all(data.assistants.map(loadAssistantImage)).then(images => {
      if (!cancelled) setAssistantImages(images)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  return <>{children}</>
}

/**
 * One assistant's avatar. Returns an entry either way, so the caller can
 * replace the whole list in one write — a missing image is still a known
 * answer for that assistant, not an absence.
 */
async function loadAssistantImage(
  assistant: Tables<"assistants">
): Promise<AssistantImage> {
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

  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const base64 = await convertBlobToBase64(blob)

    return {
      assistantId: assistant.id,
      path: assistant.image_path,
      base64,
      url
    }
  } catch {
    // An avatar that will not load must not take the workspace down with it.
    return {
      assistantId: assistant.id,
      path: assistant.image_path,
      base64: "",
      url
    }
  }
}
