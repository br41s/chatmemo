import { workspaceItems } from "./workspace-items"

const assistants = workspaceItems("assistants")

export const getAssistantWorkspacesByAssistantId = assistants.getWorkspaces
export const createAssistant = assistants.create
export const createAssistantWorkspaces = assistants.createWorkspaceLinks
export const updateAssistant = assistants.update
export const deleteAssistant = assistants.remove
export const deleteAssistantWorkspace = assistants.removeFromWorkspace
