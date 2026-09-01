"use client"

import { getAssistantCollectionsByAssistantId } from "@/db/assistant-collections"
import { getAssistantFilesByAssistantId } from "@/db/assistant-files"
import { getAssistantToolsByAssistantId } from "@/db/assistant-tools"
import { getCollectionFilesByCollectionId } from "@/db/collection-files"
import { Tables } from "@/supabase/types"
import { CollectionFile, ContentType } from "@/types"
import { useState } from "react"

/**
 * What a collection or an assistant is linked to.
 *
 * Each pair is "what was linked when the sheet opened" and "what has been
 * clicked since" — a toggle log, not a desired state, which is what
 * `resolveToggles` exists to read. Only two content types have any of this;
 * the rest render `null`.
 */
export function useItemLinks() {
  const [startingCollectionFiles, setStartingCollectionFiles] = useState<
    CollectionFile[]
  >([])
  const [selectedCollectionFiles, setSelectedCollectionFiles] = useState<
    CollectionFile[]
  >([])

  const [startingAssistantFiles, setStartingAssistantFiles] = useState<
    Tables<"files">[]
  >([])
  const [startingAssistantCollections, setStartingAssistantCollections] =
    useState<Tables<"collections">[]>([])
  const [startingAssistantTools, setStartingAssistantTools] = useState<
    Tables<"tools">[]
  >([])
  const [selectedAssistantFiles, setSelectedAssistantFiles] = useState<
    Tables<"files">[]
  >([])
  const [selectedAssistantCollections, setSelectedAssistantCollections] =
    useState<Tables<"collections">[]>([])
  const [selectedAssistantTools, setSelectedAssistantTools] = useState<
    Tables<"tools">[]
  >([])

  /** What the item is linked to right now, read when the sheet opens. */
  const load = async (contentType: ContentType, itemId: string) => {
    if (contentType === "collections") {
      const collectionFiles = await getCollectionFilesByCollectionId(itemId)
      setStartingCollectionFiles(collectionFiles.files)
      setSelectedCollectionFiles([])
      return
    }

    if (contentType === "assistants") {
      const [files, collections, tools] = await Promise.all([
        getAssistantFilesByAssistantId(itemId),
        getAssistantCollectionsByAssistantId(itemId),
        getAssistantToolsByAssistantId(itemId)
      ])

      setStartingAssistantFiles(files.files)
      setStartingAssistantCollections(collections.collections)
      setStartingAssistantTools(tools.tools)

      setSelectedAssistantFiles([])
      setSelectedAssistantCollections([])
      setSelectedAssistantTools([])
    }
  }

  /** The shape `renderInputs` receives, keyed by content type. */
  const renderState = {
    chats: null,
    presets: null,
    prompts: null,
    files: null,
    collections: {
      startingCollectionFiles,
      setStartingCollectionFiles,
      selectedCollectionFiles,
      setSelectedCollectionFiles
    },
    assistants: {
      startingAssistantFiles,
      setStartingAssistantFiles,
      startingAssistantCollections,
      setStartingAssistantCollections,
      startingAssistantTools,
      setStartingAssistantTools,
      selectedAssistantFiles,
      setSelectedAssistantFiles,
      selectedAssistantCollections,
      setSelectedAssistantCollections,
      selectedAssistantTools,
      setSelectedAssistantTools
    },
    tools: null,
    models: null
  }

  return {
    load,
    renderState,
    startingCollectionFiles,
    selectedCollectionFiles,
    startingAssistantFiles,
    selectedAssistantFiles,
    startingAssistantCollections,
    selectedAssistantCollections,
    startingAssistantTools,
    selectedAssistantTools
  }
}
