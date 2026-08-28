import { MemoryReport } from "@/lib/memory-report"
import { Tables } from "@/supabase/types"
import {
  ChatFile,
  ChatSettings,
  LLM,
  MessageImage,
  OpenRouterLLM,
  WorkspaceImage
} from "@/types"
import { AssistantImage } from "@/types/images/assistant-image"
import { VALID_ENV_KEYS } from "@/types/valid-keys"
import { Dispatch, SetStateAction, createContext } from "react"

// Everything that is not the composer and not the stream in flight.
//
// The streaming state (`chatMessages`, `isGenerating`, `firstTokenReceived`,
// `abortController`, `toolInUse`) lives in ChatStreamContext and the composer's
// state in ChatInputContext, so a token or a keystroke no longer re-renders
// every consumer of this one.
interface ChatbotUIContext {
  // PROFILE STORE
  profile: Tables<"profiles"> | null
  setProfile: Dispatch<SetStateAction<Tables<"profiles"> | null>>
  // ITEMS STORE
  assistants: Tables<"assistants">[]
  setAssistants: Dispatch<SetStateAction<Tables<"assistants">[]>>
  collections: Tables<"collections">[]
  setCollections: Dispatch<SetStateAction<Tables<"collections">[]>>
  chats: Tables<"chats">[]
  setChats: Dispatch<SetStateAction<Tables<"chats">[]>>
  files: Tables<"files">[]
  setFiles: Dispatch<SetStateAction<Tables<"files">[]>>
  folders: Tables<"folders">[]
  setFolders: Dispatch<SetStateAction<Tables<"folders">[]>>
  models: Tables<"models">[]
  setModels: Dispatch<SetStateAction<Tables<"models">[]>>
  presets: Tables<"presets">[]
  setPresets: Dispatch<SetStateAction<Tables<"presets">[]>>
  prompts: Tables<"prompts">[]
  setPrompts: Dispatch<SetStateAction<Tables<"prompts">[]>>
  tools: Tables<"tools">[]
  setTools: Dispatch<SetStateAction<Tables<"tools">[]>>
  workspaces: Tables<"workspaces">[]
  setWorkspaces: Dispatch<SetStateAction<Tables<"workspaces">[]>>
  // MODELS STORE
  envKeyMap: Record<string, VALID_ENV_KEYS>
  setEnvKeyMap: Dispatch<SetStateAction<Record<string, VALID_ENV_KEYS>>>
  availableHostedModels: LLM[]
  setAvailableHostedModels: Dispatch<SetStateAction<LLM[]>>
  availableLocalModels: LLM[]
  setAvailableLocalModels: Dispatch<SetStateAction<LLM[]>>
  availableOpenRouterModels: OpenRouterLLM[]
  setAvailableOpenRouterModels: Dispatch<SetStateAction<OpenRouterLLM[]>>
  // WORKSPACE STORE
  selectedWorkspace: Tables<"workspaces"> | null
  setSelectedWorkspace: Dispatch<SetStateAction<Tables<"workspaces"> | null>>
  workspaceImages: WorkspaceImage[]
  setWorkspaceImages: Dispatch<SetStateAction<WorkspaceImage[]>>
  // PRESET STORE
  selectedPreset: Tables<"presets"> | null
  setSelectedPreset: Dispatch<SetStateAction<Tables<"presets"> | null>>
  // ASSISTANT STORE
  selectedAssistant: Tables<"assistants"> | null
  setSelectedAssistant: Dispatch<SetStateAction<Tables<"assistants"> | null>>
  assistantImages: AssistantImage[]
  setAssistantImages: Dispatch<SetStateAction<AssistantImage[]>>
  openaiAssistants: any[]
  setOpenaiAssistants: Dispatch<SetStateAction<any[]>>
  // PASSIVE CHAT STORE
  chatSettings: ChatSettings | null
  setChatSettings: Dispatch<SetStateAction<ChatSettings>>
  selectedChat: Tables<"chats"> | null
  setSelectedChat: Dispatch<SetStateAction<Tables<"chats"> | null>>
  chatFileItems: Tables<"file_items">[]
  setChatFileItems: Dispatch<SetStateAction<Tables<"file_items">[]>>
  // ATTACHMENTS STORE
  chatFiles: ChatFile[]
  setChatFiles: Dispatch<SetStateAction<ChatFile[]>>
  chatImages: MessageImage[]
  setChatImages: Dispatch<SetStateAction<MessageImage[]>>
  newMessageFiles: ChatFile[]
  setNewMessageFiles: Dispatch<SetStateAction<ChatFile[]>>
  newMessageImages: MessageImage[]
  setNewMessageImages: Dispatch<SetStateAction<MessageImage[]>>
  showFilesDisplay: boolean
  setShowFilesDisplay: Dispatch<SetStateAction<boolean>>
  // RETRIEVAL STORE
  useRetrieval: boolean
  setUseRetrieval: Dispatch<SetStateAction<boolean>>
  sourceCount: number
  setSourceCount: Dispatch<SetStateAction<number>>
  // TOOL STORE
  selectedTools: Tables<"tools">[]
  setSelectedTools: Dispatch<SetStateAction<Tables<"tools">[]>>
  // MEMORY STORE
  // What memory each assistant turn was given, keyed by message id.
  memoryReports: Record<string, MemoryReport>
  setMemoryReports: Dispatch<SetStateAction<Record<string, MemoryReport>>>
}
export const ChatbotUIContext = createContext<ChatbotUIContext>({
  // PROFILE STORE
  profile: null,
  setProfile: () => {},
  // ITEMS STORE
  assistants: [],
  setAssistants: () => {},
  collections: [],
  setCollections: () => {},
  chats: [],
  setChats: () => {},
  files: [],
  setFiles: () => {},
  folders: [],
  setFolders: () => {},
  models: [],
  setModels: () => {},
  presets: [],
  setPresets: () => {},
  prompts: [],
  setPrompts: () => {},
  tools: [],
  setTools: () => {},
  workspaces: [],
  setWorkspaces: () => {},
  // MODELS STORE
  envKeyMap: {},
  setEnvKeyMap: () => {},
  availableHostedModels: [],
  setAvailableHostedModels: () => {},
  availableLocalModels: [],
  setAvailableLocalModels: () => {},
  availableOpenRouterModels: [],
  setAvailableOpenRouterModels: () => {},
  // WORKSPACE STORE
  selectedWorkspace: null,
  setSelectedWorkspace: () => {},
  workspaceImages: [],
  setWorkspaceImages: () => {},
  // PRESET STORE
  selectedPreset: null,
  setSelectedPreset: () => {},
  // ASSISTANT STORE
  selectedAssistant: null,
  setSelectedAssistant: () => {},
  assistantImages: [],
  setAssistantImages: () => {},
  openaiAssistants: [],
  setOpenaiAssistants: () => {},
  // PASSIVE CHAT STORE
  selectedChat: null,
  setSelectedChat: () => {},
  chatSettings: null,
  setChatSettings: () => {},
  chatFileItems: [],
  setChatFileItems: () => {},
  // ATTACHMENTS STORE
  chatFiles: [],
  setChatFiles: () => {},
  chatImages: [],
  setChatImages: () => {},
  newMessageFiles: [],
  setNewMessageFiles: () => {},
  newMessageImages: [],
  setNewMessageImages: () => {},
  showFilesDisplay: false,
  setShowFilesDisplay: () => {},
  // RETRIEVAL STORE
  useRetrieval: false,
  setUseRetrieval: () => {},
  sourceCount: 4,
  setSourceCount: () => {},
  // TOOL STORE
  selectedTools: [],
  setSelectedTools: () => {},
  // MEMORY STORE
  memoryReports: {},
  setMemoryReports: () => {}
})
