import { AssignWorkspaces } from "@/components/workspace/assign-workspaces"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { ChatbotUIContext } from "@/context/context"
import {
  createAssistantCollection,
  deleteAssistantCollection
} from "@/db/assistant-collections"
import { createAssistantFile, deleteAssistantFile } from "@/db/assistant-files"
import { createAssistantTool, deleteAssistantTool } from "@/db/assistant-tools"
import {
  createAssistantWorkspaces,
  deleteAssistantWorkspace,
  updateAssistant
} from "@/db/assistants"
import { updateChat } from "@/db/chats"
import {
  createCollectionFile,
  deleteCollectionFile
} from "@/db/collection-files"
import {
  createCollectionWorkspaces,
  deleteCollectionWorkspace,
  updateCollection
} from "@/db/collections"
import {
  createFileWorkspaces,
  deleteFileWorkspace,
  updateFile
} from "@/db/files"
import {
  createModelWorkspaces,
  deleteModelWorkspace,
  updateModel
} from "@/db/models"
import {
  createPresetWorkspaces,
  deletePresetWorkspace,
  updatePreset
} from "@/db/presets"
import {
  createPromptWorkspaces,
  deletePromptWorkspace,
  updatePrompt
} from "@/db/prompts"
import { getAssistantImageFromStorage } from "@/db/storage/assistant-images"
import { uploadAssistantImage } from "@/db/storage/assistant-images"
import {
  createToolWorkspaces,
  deleteToolWorkspace,
  updateTool
} from "@/db/tools"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import { singularize } from "@/lib/sidebar-item-links"
import { TablesUpdate } from "@/supabase/types"
import { ContentType, DataItemType } from "@/types"
import { FC, useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { SidebarDeleteItem } from "./sidebar-delete-item"
import { syncItemLinks } from "./sync-item-links"
import { useItemLinks } from "./use-item-links"
import { useItemWorkspaces } from "./use-item-workspaces"

interface SidebarUpdateItemProps {
  isTyping: boolean
  item: DataItemType
  contentType: ContentType
  children: React.ReactNode
  renderInputs: (renderState: any) => JSX.Element
  updateState: any
}

/**
 * The edit sheet behind every sidebar item.
 *
 * This was 679 lines, most of it two things repeated: the same workspace
 * reassignment for seven content types, and the same "what was clicked, so what
 * has to be linked and unlinked" arithmetic four times over. Both live in their
 * own modules now — and the arithmetic is worth reading twice, because the two
 * pickers in here mean opposite things by "selected".
 */
export const SidebarUpdateItem: FC<SidebarUpdateItemProps> = ({
  item,
  contentType,
  children,
  renderInputs,
  updateState,
  isTyping
}) => {
  const {
    workspaces,
    selectedWorkspace,
    setChats,
    setPresets,
    setPrompts,
    setFiles,
    setCollections,
    setAssistants,
    setTools,
    setModels,
    setAssistantImages
  } = useContext(ChatbotUIContext)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  const itemWorkspaces = useItemWorkspaces(contentType)
  const links = useItemLinks()

  useEffect(() => {
    if (!isOpen) return

    const load = async () => {
      if (workspaces.length > 1) await itemWorkspaces.load(item.id)
      await links.load(contentType, item.id)
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const stateUpdateFunctions = {
    chats: setChats,
    presets: setPresets,
    prompts: setPrompts,
    files: setFiles,
    collections: setCollections,
    assistants: setAssistants,
    tools: setTools,
    models: setModels
  }

  /**
   * Reassign workspaces, and drop the item from the sidebar if it just left the
   * one being viewed.
   */
  const applyWorkspaces = async (
    itemIdKey: string,
    removeLink: (itemId: string, workspaceId: string) => Promise<boolean>,
    createLinks: (links: any[]) => Promise<void>
  ) => {
    const { leftCurrentWorkspace } = await itemWorkspaces.applyChanges(
      item.id,
      itemIdKey,
      selectedWorkspace?.id,
      removeLink,
      createLinks
    )

    if (leftCurrentWorkspace) {
      const setStateFunction = stateUpdateFunctions[contentType]
      setStateFunction?.((previous: any) =>
        previous.filter((existing: any) => existing.id !== item.id)
      )
    }
  }

  const updateFunctions = {
    chats: updateChat,

    presets: async (id: string, state: TablesUpdate<"presets">) => {
      const updated = await updatePreset(id, state)
      await applyWorkspaces(
        "preset_id",
        deletePresetWorkspace,
        createPresetWorkspaces as any
      )
      return updated
    },

    prompts: async (id: string, state: TablesUpdate<"prompts">) => {
      const updated = await updatePrompt(id, state)
      await applyWorkspaces(
        "prompt_id",
        deletePromptWorkspace,
        createPromptWorkspaces as any
      )
      return updated
    },

    files: async (id: string, state: TablesUpdate<"files">) => {
      const updated = await updateFile(id, state)
      await applyWorkspaces(
        "file_id",
        deleteFileWorkspace,
        createFileWorkspaces as any
      )
      return updated
    },

    collections: async (id: string, state: TablesUpdate<"collections">) => {
      await syncItemLinks({
        starting: links.startingCollectionFiles,
        toggled: links.selectedCollectionFiles,
        link: file =>
          createCollectionFile({
            user_id: item.user_id,
            collection_id: id,
            file_id: file.id
          }),
        unlink: file => deleteCollectionFile(id, file.id)
      })

      const updated = await updateCollection(id, state)

      await applyWorkspaces(
        "collection_id",
        deleteCollectionWorkspace,
        createCollectionWorkspaces as any
      )

      return updated
    },

    assistants: async (
      id: string,
      state: { image: File } & TablesUpdate<"assistants">
    ) => {
      const { image, ...rest } = state

      await syncItemLinks({
        starting: links.startingAssistantFiles,
        toggled: links.selectedAssistantFiles,
        link: file =>
          createAssistantFile({
            user_id: item.user_id,
            assistant_id: id,
            file_id: file.id
          }),
        unlink: file => deleteAssistantFile(id, file.id)
      })

      await syncItemLinks({
        starting: links.startingAssistantCollections,
        toggled: links.selectedAssistantCollections,
        link: collection =>
          createAssistantCollection({
            user_id: item.user_id,
            assistant_id: id,
            collection_id: collection.id
          }),
        unlink: collection => deleteAssistantCollection(id, collection.id)
      })

      await syncItemLinks({
        starting: links.startingAssistantTools,
        toggled: links.selectedAssistantTools,
        link: tool =>
          createAssistantTool({
            user_id: item.user_id,
            assistant_id: id,
            tool_id: tool.id
          }),
        unlink: tool => deleteAssistantTool(id, tool.id)
      })

      let updated = await updateAssistant(id, rest)

      if (image) {
        const filePath = await uploadAssistantImage(updated, image)
        updated = await updateAssistant(id, { image_path: filePath })

        const url = (await getAssistantImageFromStorage(filePath)) || ""

        if (url) {
          const response = await fetch(url)
          const base64 = await convertBlobToBase64(await response.blob())

          setAssistantImages(previous => [
            ...previous,
            { assistantId: updated.id, path: filePath, base64, url }
          ])
        }
      }

      await applyWorkspaces(
        "assistant_id",
        deleteAssistantWorkspace,
        createAssistantWorkspaces as any
      )

      return updated
    },

    tools: async (id: string, state: TablesUpdate<"tools">) => {
      const updated = await updateTool(id, state)
      await applyWorkspaces(
        "tool_id",
        deleteToolWorkspace,
        createToolWorkspaces as any
      )
      return updated
    },

    models: async (id: string, state: TablesUpdate<"models">) => {
      const updated = await updateModel(id, state)
      await applyWorkspaces(
        "model_id",
        deleteModelWorkspace,
        createModelWorkspaces as any
      )
      return updated
    }
  }

  const handleUpdate = async () => {
    try {
      const updateFunction = updateFunctions[contentType]
      const setStateFunction = stateUpdateFunctions[contentType]

      if (!updateFunction || !setStateFunction) return
      if (isTyping) return // Prevent update while typing

      const updatedItem = await updateFunction(item.id, updateState)

      setStateFunction((previous: any) =>
        previous.map((existing: any) =>
          existing.id === item.id ? updatedItem : existing
        )
      )

      setIsOpen(false)

      toast.success(`${singularize(contentType)} updated successfully`)
    } catch (error) {
      toast.error(`Error updating ${singularize(contentType)}. ${error}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTyping && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      buttonRef.current?.click()
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>

      <SheetContent
        className="flex min-w-[450px] flex-col justify-between"
        side="left"
        onKeyDown={handleKeyDown}
      >
        <div className="grow overflow-auto">
          <SheetHeader>
            <SheetTitle className="text-2xl font-bold">
              Edit {singularize(contentType)}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {workspaces.length > 1 && (
              <div className="space-y-1">
                <Label>Assigned Workspaces</Label>

                <AssignWorkspaces
                  selectedWorkspaces={itemWorkspaces.selected}
                  onSelectWorkspace={itemWorkspaces.toggle}
                />
              </div>
            )}

            {renderInputs(links.renderState[contentType])}
          </div>
        </div>

        <SheetFooter className="mt-2 flex justify-between">
          <SidebarDeleteItem item={item} contentType={contentType} />

          <div className="flex grow justify-end space-x-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>

            <Button ref={buttonRef} onClick={handleUpdate}>
              Save
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
