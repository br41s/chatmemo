import { useChatStream } from "@/context/chat-stream-context"
import { useChatInput } from "@/context/chat-input-context"
import { ChatbotUIContext } from "@/context/context"
import { getAssistantCollectionsByAssistantId } from "@/db/assistant-collections"
import { getAssistantFilesByAssistantId } from "@/db/assistant-files"
import { getAssistantToolsByAssistantId } from "@/db/assistant-tools"
import { updateChat } from "@/db/chats"
import { getCollectionFilesByCollectionId } from "@/db/collection-files"
import { deleteMessagesIncludingAndAfter } from "@/db/messages"
import { buildFinalMessages } from "@/lib/build-prompt"
import { resolveContextBudget } from "@/lib/context-budget"
import { MemoryReport } from "@/lib/memory-report"
import { resolveModelWindow } from "@/lib/models/model-window"
import { Tables } from "@/supabase/types"
import { ChatMessage, ChatPayload, LLMID, ModelProvider } from "@/types"
import { useRouter } from "next/navigation"
import { useContext, useEffect, useRef } from "react"
import { toast } from "sonner"
import { LLM_LIST } from "../../../lib/models/llm/llm-list"
import {
  createTempMessages,
  handleCreateChat,
  handleCreateMessages,
  handleHostedChat,
  handleLocalChat,
  handleRetrieval,
  processResponse,
  RegenerationTarget,
  rollbackFailedChatMessages,
  validateChatSettings
} from "../chat-helpers"

export const useChatHandler = () => {
  const router = useRouter()

  const {
    chatFiles,
    setNewMessageImages,
    profile,
    selectedChat,
    selectedWorkspace,
    setSelectedChat,
    setChats,
    setSelectedTools,
    availableLocalModels,
    availableOpenRouterModels,
    chatSettings,
    newMessageImages,
    selectedAssistant,
    chatImages,
    setChatImages,
    setChatFiles,
    setNewMessageFiles,
    setShowFilesDisplay,
    newMessageFiles,
    chatFileItems,
    setChatFileItems,
    useRetrieval,
    sourceCount,
    selectedTools,
    selectedPreset,
    setChatSettings,
    models,
    setMemoryReports
  } = useContext(ChatbotUIContext)

  const {
    setIsGenerating,
    setChatMessages,
    setFirstTokenReceived,
    abortController,
    setAbortController,
    chatMessages,
    setToolInUse
  } = useChatStream()

  const {
    setUserInput,
    setIsPromptPickerOpen,
    setIsFilePickerOpen,
    isPromptPickerOpen,
    isFilePickerOpen,
    isToolPickerOpen
  } = useChatInput()

  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isPromptPickerOpen || !isFilePickerOpen || !isToolPickerOpen) {
      chatInputRef.current?.focus()
    }
  }, [isPromptPickerOpen, isFilePickerOpen, isToolPickerOpen])

  const handleNewChat = async () => {
    if (!selectedWorkspace) return

    setUserInput("")
    setChatMessages([])
    setSelectedChat(null)
    setChatFileItems([])

    setIsGenerating(false)
    setFirstTokenReceived(false)

    setChatFiles([])
    setChatImages([])
    setNewMessageFiles([])
    setNewMessageImages([])
    setShowFilesDisplay(false)
    setIsPromptPickerOpen(false)
    setIsFilePickerOpen(false)

    setSelectedTools([])
    setToolInUse("none")

    if (selectedAssistant) {
      setChatSettings({
        model: selectedAssistant.model as LLMID,
        prompt: selectedAssistant.prompt,
        temperature: selectedAssistant.temperature,
        contextLength: selectedAssistant.context_length,
        includeProfileContext: selectedAssistant.include_profile_context,
        includeWorkspaceInstructions:
          selectedAssistant.include_workspace_instructions,
        embeddingsProvider: selectedAssistant.embeddings_provider as
          | "openai"
          | "local"
      })

      let allFiles = []

      const assistantFiles = (
        await getAssistantFilesByAssistantId(selectedAssistant.id)
      ).files
      allFiles = [...assistantFiles]
      const assistantCollections = (
        await getAssistantCollectionsByAssistantId(selectedAssistant.id)
      ).collections
      for (const collection of assistantCollections) {
        const collectionFiles = (
          await getCollectionFilesByCollectionId(collection.id)
        ).files
        allFiles = [...allFiles, ...collectionFiles]
      }
      const assistantTools = (
        await getAssistantToolsByAssistantId(selectedAssistant.id)
      ).tools

      setSelectedTools(assistantTools)
      setChatFiles(
        allFiles.map(file => ({
          id: file.id,
          name: file.name,
          type: file.type,
          file: null
        }))
      )

      if (allFiles.length > 0) setShowFilesDisplay(true)
    } else if (selectedPreset) {
      setChatSettings({
        model: selectedPreset.model as LLMID,
        prompt: selectedPreset.prompt,
        temperature: selectedPreset.temperature,
        contextLength: selectedPreset.context_length,
        includeProfileContext: selectedPreset.include_profile_context,
        includeWorkspaceInstructions:
          selectedPreset.include_workspace_instructions,
        embeddingsProvider: selectedPreset.embeddings_provider as
          | "openai"
          | "local"
      })
    }

    // A third branch used to reset chat settings from the workspace defaults
    // here. It has been commented out since the fork; the workspace layout
    // already applies those defaults on load, so re-applying them on every new
    // chat would discard whatever the person had just chosen.

    return router.push(`/${selectedWorkspace.id}/chat`)
  }

  const handleFocusChatInput = () => {
    chatInputRef.current?.focus()
  }

  const handleStopMessage = () => {
    if (abortController) {
      abortController.abort()
    }
  }

  // The optimistic message id is temporary: handleCreateMessages replaces it
  // with the persisted row's id once the turn is saved, so the report is
  // re-keyed there rather than being lost.
  const recordMemoryReport = (messageId: string, report: MemoryReport) => {
    setMemoryReports(prev => ({ ...prev, [messageId]: report }))
  }

  const handleSendMessage = async (
    messageContent: string,
    chatMessages: ChatMessage[],
    isRegeneration: boolean
  ) => {
    const startingInput = messageContent
    const lastChatMessage = chatMessages[chatMessages.length - 1]
    const regenerationTarget: RegenerationTarget | null =
      isRegeneration && lastChatMessage
        ? {
            id: lastChatMessage.message.id,
            content: lastChatMessage.message.content
          }
        : null

    try {
      setUserInput("")
      setIsGenerating(true)
      setIsPromptPickerOpen(false)
      setIsFilePickerOpen(false)
      setNewMessageImages([])

      const newAbortController = new AbortController()
      setAbortController(newAbortController)

      const modelData = [
        ...models.map(model => ({
          modelId: model.model_id as LLMID,
          modelName: model.name,
          provider: "custom" as ModelProvider,
          hostedId: model.id,
          platformLink: "",
          imageInput: false
        })),
        ...LLM_LIST,
        ...availableLocalModels,
        ...availableOpenRouterModels
      ].find(llm => llm.modelId === chatSettings?.model)

      validateChatSettings(
        chatSettings,
        modelData,
        profile,
        selectedWorkspace,
        messageContent
      )

      // The assistant message this turn writes into — the report describes
      // what that answer was given, so it is stored against that id.
      const reportTargetId = isRegeneration ? lastChatMessage?.message.id : null

      // One budget for the turn. The client trims history to its share; the
      // server sizes the memory block to the rest of the same window.
      const budgetHint = resolveModelWindow(
        chatSettings!.model,
        availableOpenRouterModels,
        chatSettings!.contextLength
      )
      const budget = resolveContextBudget(budgetHint)

      let currentChat = selectedChat ? { ...selectedChat } : null

      const b64Images = newMessageImages.map(image => image.base64)

      let retrievedFileItems: Tables<"file_items">[] = []

      if (
        (newMessageFiles.length > 0 || chatFiles.length > 0) &&
        useRetrieval
      ) {
        setToolInUse("retrieval")

        retrievedFileItems = await handleRetrieval(
          messageContent,
          newMessageFiles,
          chatFiles,
          chatSettings!.embeddingsProvider,
          sourceCount,
          newAbortController.signal
        )
      }

      const { tempUserChatMessage, tempAssistantChatMessage } =
        createTempMessages(
          messageContent,
          chatMessages,
          chatSettings!,
          b64Images,
          isRegeneration,
          setChatMessages,
          selectedAssistant
        )

      let payload: ChatPayload = {
        chatSettings: chatSettings!,
        workspaceInstructions: selectedWorkspace!.instructions || "",
        chatMessages: isRegeneration
          ? [...chatMessages]
          : [...chatMessages, tempUserChatMessage],
        assistant: selectedChat?.assistant_id ? selectedAssistant : null,
        messageFileItems: retrievedFileItems,
        chatFileItems: chatFileItems
      }

      let generatedText = ""

      const isToolsCompatible =
        modelData?.provider === "openai" || modelData?.provider === "openrouter"

      if (selectedTools.length > 0 && !isToolsCompatible) {
        toast.error(
          `Tools are only supported with OpenAI and OpenRouter models. Switch your model to use tools.`
        )
      }

      if (selectedTools.length > 0 && isToolsCompatible) {
        setToolInUse("Tools")

        // History is trimmed to the same budget, but no hint is sent: the
        // tools route injects no memory, so there is no memory block for the
        // server to size.
        const formattedMessages = await buildFinalMessages(
          payload,
          profile!,
          chatImages,
          budget
        )

        const response = await fetch("/api/chat/tools", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chatSettings: payload.chatSettings,
            messages: formattedMessages,
            selectedToolIds: selectedTools.map(tool => tool.id)
          }),
          signal: newAbortController.signal
        })

        setToolInUse("none")

        if (!response.ok) {
          const errorData = await response.json().catch(() => null)
          const errorMessage =
            errorData?.message || "The selected tool request failed."
          toast.error(errorMessage)
          rollbackFailedChatMessages(setChatMessages, regenerationTarget)
          throw new Error(errorMessage)
        }

        generatedText = await processResponse(
          response,
          isRegeneration
            ? payload.chatMessages[payload.chatMessages.length - 1]
            : tempAssistantChatMessage,
          true,
          newAbortController,
          setFirstTokenReceived,
          setChatMessages,
          setToolInUse
        )
      } else {
        if (modelData!.provider === "ollama") {
          generatedText = await handleLocalChat(
            payload,
            profile!,
            chatSettings!,
            tempAssistantChatMessage,
            isRegeneration,
            regenerationTarget,
            newAbortController,
            budget,
            setIsGenerating,
            setFirstTokenReceived,
            setChatMessages,
            setToolInUse,
            report =>
              recordMemoryReport(
                reportTargetId ?? tempAssistantChatMessage.message.id,
                report
              )
          )
        } else {
          generatedText = await handleHostedChat(
            payload,
            profile!,
            modelData!,
            tempAssistantChatMessage,
            isRegeneration,
            regenerationTarget,
            newAbortController,
            newMessageImages,
            chatImages,
            budget,
            budgetHint,
            setIsGenerating,
            setFirstTokenReceived,
            setChatMessages,
            setToolInUse,
            report =>
              recordMemoryReport(
                reportTargetId ?? tempAssistantChatMessage.message.id,
                report
              )
          )
        }
      }

      if (!currentChat) {
        currentChat = await handleCreateChat(
          chatSettings!,
          profile!,
          selectedWorkspace!,
          messageContent,
          selectedAssistant!,
          newMessageFiles,
          setSelectedChat,
          setChats,
          setChatFiles
        )
      } else {
        const updatedChat = await updateChat(currentChat.id, {
          updated_at: new Date().toISOString()
        })

        setChats(prevChats => {
          const updatedChats = prevChats.map(prevChat =>
            prevChat.id === updatedChat.id ? updatedChat : prevChat
          )

          return updatedChats
        })
      }

      const persistedAssistantId = await handleCreateMessages(
        chatMessages,
        currentChat,
        profile!,
        modelData!,
        messageContent,
        generatedText,
        newMessageImages,
        isRegeneration,
        retrievedFileItems,
        setChatMessages,
        setChatFileItems,
        setChatImages,
        selectedAssistant
      )

      // Move the report from the optimistic id to the persisted one, so the
      // indicator survives a reload of the conversation in this session.
      const optimisticId = tempAssistantChatMessage.message.id
      if (persistedAssistantId && persistedAssistantId !== optimisticId) {
        setMemoryReports(prev => {
          const report = prev[optimisticId]
          if (!report) return prev
          const { [optimisticId]: _dropped, ...rest } = prev
          return { ...rest, [persistedAssistantId]: report }
        })
      }

      // Fire-and-forget: write memory summary after messages are persisted.
      // chatMessages.length >= 2 ensures there were already ≥1 full turn before
      // this one, making ≥4 total messages — enough for a useful summary.
      //
      // keepalive, because the moment right after an answer finishes is the
      // most natural one to close the tab or navigate away, and without it the
      // browser cancels this request in flight — losing the turn from memory,
      // on the feature the product exists for. The body is a single id, far
      // inside the 64 KB keepalive limit.
      if (currentChat?.id && chatMessages.length >= 2) {
        fetch("/api/memory/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: currentChat.id }),
          keepalive: true
        }).catch(error => {
          // Still non-fatal — a failed summary must never disturb the chat —
          // but silence made this indistinguishable from success.
          console.warn("Memory summary request failed:", error)
        })
      }

      setIsGenerating(false)
      setFirstTokenReceived(false)
    } catch (error) {
      setIsGenerating(false)
      setFirstTokenReceived(false)
      setUserInput(startingInput)
    }
  }

  const handleSendEdit = async (
    editedContent: string,
    sequenceNumber: number
  ) => {
    if (!selectedChat) return

    await deleteMessagesIncludingAndAfter(
      selectedChat.user_id,
      selectedChat.id,
      sequenceNumber
    )

    const filteredMessages = chatMessages.filter(
      chatMessage => chatMessage.message.sequence_number < sequenceNumber
    )

    setChatMessages(filteredMessages)

    handleSendMessage(editedContent, filteredMessages, false)
  }

  return {
    chatInputRef,
    prompt,
    handleNewChat,
    handleSendMessage,
    handleFocusChatInput,
    handleStopMessage,
    handleSendEdit
  }
}
