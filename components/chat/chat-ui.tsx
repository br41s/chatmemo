import Loading from "@/app/[locale]/loading"
import { useChatHandler } from "@/components/chat/chat-hooks/use-chat-handler"
import { useChatStream } from "@/context/chat-stream-context"
import { Button } from "@/components/ui/button"
import { ChatbotUIContext } from "@/context/context"
import { cn } from "@/lib/utils"
import { getAssistantToolsByAssistantId } from "@/db/assistant-tools"
import { getChatFilesByChatId } from "@/db/chat-files"
import { getChatById } from "@/db/chats"
import { getMessagesByChatId, type MessageWithFileItems } from "@/db/messages"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import { supabase } from "@/lib/supabase/browser-client"
import useHotkey from "@/lib/hooks/use-hotkey"
import { LLMID, MessageImage } from "@/types"
import { useParams } from "next/navigation"
import { FC, useContext, useEffect, useState } from "react"
import { ChatHelp } from "./chat-help"
import { CHAT_COMPOSER_CONTAINER } from "./chat-layout"
import { useScroll } from "./chat-hooks/use-scroll"
import { ChatInput } from "./chat-input"
import { ChatMessages } from "./chat-messages"
import { ChatScrollButtons } from "./chat-scroll-buttons"
import { ChatSecondaryButtons } from "./chat-secondary-buttons"

interface ChatUIProps {}

export const ChatUI: FC<ChatUIProps> = ({}) => {
  useHotkey("o", () => handleNewChat())

  const params = useParams()

  const {
    selectedChat,
    setSelectedChat,
    setChatSettings,
    setChatImages,
    assistants,
    setSelectedAssistant,
    setChatFileItems,
    setChatFiles,
    setShowFilesDisplay,
    setUseRetrieval,
    setSelectedTools
  } = useContext(ChatbotUIContext)

  const { setChatMessages } = useChatStream()

  const { handleNewChat, handleFocusChatInput } = useChatHandler()

  const {
    messagesStartRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom,
    setIsAtBottom,
    isAtTop,
    isAtBottom,
    isOverflowing,
    scrollToTop
  } = useScroll()

  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  // Tracked here rather than read off the transcript: subscribing to
  // `chatMessages` would re-render this component on every streamed token.
  const [oldestSequence, setOldestSequence] = useState<number | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      await fetchMessages()
      await fetchChat()

      scrollToBottom()
      setIsAtBottom(true)
    }

    if (params.chatid) {
      fetchData().then(() => {
        handleFocusChatInput()
        setLoading(false)
      })
    } else {
      setLoading(false)
    }
  }, [])

  /**
   * Everything the transcript needs, in one query.
   *
   * This used to render nothing until it had finished: the messages, then one
   * file-items query per message, then a signed URL per image, then a download
   * and a base64 encode per image, then the chat's files — roughly `2 + M + 2I`
   * round trips for a chat of M messages and I images, all before the first
   * word appeared.
   *
   * Now the one query that produces the transcript is the only thing that
   * blocks. Images and the file strip resolve behind it and appear when they
   * are ready.
   */
  const fetchMessages = async () => {
    const { messages, hasOlder } = await getMessagesByChatId(
      params.chatid as string
    )

    setChatFileItems(messages.flatMap(message => message.file_items))
    setChatMessages(
      messages.map(message => ({
        message,
        fileItems: message.file_items.map(fileItem => fileItem.id)
      }))
    )
    setHasOlderMessages(hasOlder)
    setOldestSequence(messages[0]?.sequence_number ?? null)

    // Deliberately not awaited: none of this is needed to read the
    // conversation, and waiting on it is what made opening a chat feel slow.
    void loadAttachments(messages)
  }

  /** The older page, prepended. */
  const loadOlderMessages = async () => {
    if (oldestSequence === null || loadingOlder) return

    setLoadingOlder(true)
    try {
      const { messages, hasOlder } = await getMessagesByChatId(
        params.chatid as string,
        { before: oldestSequence }
      )

      setChatFileItems(previous => [
        ...messages.flatMap(message => message.file_items),
        ...previous
      ])
      setChatMessages(previous => [
        ...messages.map(message => ({
          message,
          fileItems: message.file_items.map(fileItem => fileItem.id)
        })),
        ...previous
      ])
      setHasOlderMessages(hasOlder)
      if (messages.length > 0) setOldestSequence(messages[0].sequence_number)

      void loadAttachments(messages)
    } finally {
      setLoadingOlder(false)
    }
  }

  /**
   * Images and the file strip, once the conversation is already on screen.
   *
   * One `createSignedUrls` call covers every image rather than one call each.
   * The URL alone is enough to display the image — the browser fetches it
   * lazily — so the base64 that the vision providers need is encoded after,
   * without holding anything up.
   */
  const loadAttachments = async (messages: MessageWithFileItems[]) => {
    const paths = messages.flatMap(message => message.image_paths ?? [])

    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("message_images")
        .createSignedUrls(paths, 60 * 60 * 24)

      const byPath = new Map(
        (signed ?? []).map(entry => [entry.path ?? "", entry.signedUrl])
      )

      const images: MessageImage[] = messages.flatMap(message =>
        (message.image_paths ?? []).map(path => ({
          messageId: message.id,
          path,
          base64: "",
          url: byPath.get(path) ?? "",
          file: null
        }))
      )

      setChatImages(previous => [
        ...previous.filter(
          image => !images.some(fresh => fresh.path === image.path)
        ),
        ...images
      ])

      void encodeImages(images)
    }

    const chatFiles = await getChatFilesByChatId(params.chatid as string)

    setChatFiles(
      chatFiles.files.map(file => ({
        id: file.id,
        name: file.name,
        type: file.type,
        file: null
      }))
    )

    setUseRetrieval(true)
    setShowFilesDisplay(true)
  }

  /**
   * Fill in the base64 behind the rendered images.
   *
   * Anthropic's route needs a data URL rather than a link, so the encoding
   * still has to happen — just not before the person can read the
   * conversation. A send that beats this resolves the missing one on demand.
   */
  const encodeImages = async (images: MessageImage[]) => {
    await Promise.all(
      images.map(async image => {
        if (!image.url) return

        try {
          const response = await fetch(image.url)
          const base64 = await convertBlobToBase64(await response.blob())

          setChatImages(previous =>
            previous.map(existing =>
              existing.path === image.path ? { ...existing, base64 } : existing
            )
          )
        } catch {
          // A broken image is not worth failing the chat over; it simply keeps
          // rendering from its URL.
        }
      })
    )
  }

  const fetchChat = async () => {
    const chat = await getChatById(params.chatid as string)
    if (!chat) return

    if (chat.assistant_id) {
      const assistant = assistants.find(
        assistant => assistant.id === chat.assistant_id
      )

      if (assistant) {
        setSelectedAssistant(assistant)

        const assistantTools = (
          await getAssistantToolsByAssistantId(assistant.id)
        ).tools
        setSelectedTools(assistantTools)
      }
    }

    setSelectedChat(chat)
    setChatSettings({
      model: chat.model as LLMID,
      prompt: chat.prompt,
      temperature: chat.temperature,
      contextLength: chat.context_length,
      includeProfileContext: chat.include_profile_context,
      includeWorkspaceInstructions: chat.include_workspace_instructions,
      embeddingsProvider: chat.embeddings_provider as "openai" | "local"
    })
  }

  if (loading) {
    return <Loading />
  }

  return (
    <div className="relative flex h-full flex-col items-center">
      <div className="absolute left-4 top-2.5 flex justify-center">
        <ChatScrollButtons
          isAtTop={isAtTop}
          isAtBottom={isAtBottom}
          isOverflowing={isOverflowing}
          scrollToTop={scrollToTop}
          scrollToBottom={scrollToBottom}
        />
      </div>

      <div className="absolute right-4 top-1 flex h-[40px] items-center space-x-2">
        <ChatSecondaryButtons />
      </div>

      <div className="flex max-h-[50px] min-h-[50px] w-full items-center justify-center border-b-2 bg-secondary font-bold">
        <h1 className="max-w-[200px] truncate text-base font-bold sm:max-w-[400px] md:max-w-[500px] lg:max-w-[600px] xl:max-w-[700px]">
          {selectedChat?.name || "Chat"}
        </h1>
      </div>

      {/* A scrollable region needs a name and a tab stop of its own, otherwise
          a keyboard user has no way to scroll the transcript without landing on
          something inside it first. */}
      <div
        role="region"
        aria-label="Messages"
        tabIndex={0}
        className="flex size-full flex-col overflow-auto border-b focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onScroll={handleScroll}
      >
        <div ref={messagesStartRef} />

        {hasOlderMessages && (
          <div className="flex justify-center py-3">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={loadingOlder}
              onClick={loadOlderMessages}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        )}

        <ChatMessages />

        <div ref={messagesEndRef} />
      </div>

      <div className={cn("relative", CHAT_COMPOSER_CONTAINER)}>
        <ChatInput />
      </div>

      <div className="absolute bottom-2 right-2 hidden md:block lg:bottom-4 lg:right-4">
        <ChatHelp />
      </div>
    </div>
  )
}
