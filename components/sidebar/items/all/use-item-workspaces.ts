"use client"

import { getAssistantWorkspacesByAssistantId } from "@/db/assistants"
import { getCollectionWorkspacesByCollectionId } from "@/db/collections"
import { getFileWorkspacesByFileId } from "@/db/files"
import { getModelWorkspacesByModelId } from "@/db/models"
import { getPresetWorkspacesByPresetId } from "@/db/presets"
import { getPromptWorkspacesByPromptId } from "@/db/prompts"
import { getToolWorkspacesByToolId } from "@/db/tools"
import { resolveSelection, toggleInList } from "@/lib/sidebar-item-links"
import { Tables } from "@/supabase/types"
import { ContentType } from "@/types"
import { useState } from "react"

type WorkspaceReader = (itemId: string) => Promise<Tables<"workspaces">[]>

const READERS: Partial<Record<ContentType, WorkspaceReader>> = {
  presets: async id => (await getPresetWorkspacesByPresetId(id)).workspaces,
  prompts: async id => (await getPromptWorkspacesByPromptId(id)).workspaces,
  files: async id => (await getFileWorkspacesByFileId(id)).workspaces,
  collections: async id =>
    (await getCollectionWorkspacesByCollectionId(id)).workspaces,
  assistants: async id =>
    (await getAssistantWorkspacesByAssistantId(id)).workspaces,
  tools: async id => (await getToolWorkspacesByToolId(id)).workspaces,
  models: async id => (await getModelWorkspacesByModelId(id)).workspaces
}

/**
 * Which workspaces an item belongs to.
 *
 * Unlike the link pickers, this list is a desired state: it starts as what is
 * assigned and each click adds or drops one, so anything missing from it on
 * save is a removal. That is why it resolves with `resolveSelection` and the
 * others with `resolveToggles`.
 */
export function useItemWorkspaces(contentType: ContentType) {
  const [starting, setStarting] = useState<Tables<"workspaces">[]>([])
  const [selected, setSelected] = useState<Tables<"workspaces">[]>([])

  const load = async (itemId: string) => {
    const read = READERS[contentType]
    if (!read) return

    const workspaces = await read(itemId)
    setStarting(workspaces)
    setSelected(workspaces)
  }

  const toggle = (workspace: Tables<"workspaces">) =>
    setSelected(previous => toggleInList(previous, workspace))

  /**
   * Write the assignment changes.
   *
   * Returns whether the item left the workspace currently being viewed — the
   * caller drops it from the sidebar when it has, since it is no longer here.
   */
  const applyChanges = async (
    itemId: string,
    itemIdKey: string,
    currentWorkspaceId: string | undefined,
    removeLink: (itemId: string, workspaceId: string) => Promise<boolean>,
    createLinks: (
      links: { user_id: string; item_id: string; workspace_id: string }[]
    ) => Promise<void>
  ): Promise<{ leftCurrentWorkspace: boolean }> => {
    if (!currentWorkspaceId) return { leftCurrentWorkspace: false }

    const { toAdd, toRemove } = resolveSelection(starting, selected)

    for (const workspace of toRemove) {
      await removeLink(itemId, workspace.id)
    }

    await createLinks(
      toAdd.map(
        workspace =>
          ({
            user_id: workspace.user_id,
            [itemIdKey]: itemId,
            workspace_id: workspace.id
          }) as any
      )
    )

    return {
      leftCurrentWorkspace: toRemove.some(
        workspace => workspace.id === currentWorkspaceId
      )
    }
  }

  return { starting, selected, load, toggle, applyChanges }
}
