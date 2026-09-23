import { workspaceItems } from "./workspace-items"

const prompts = workspaceItems("prompts")

export const getPromptWorkspacesByPromptId = prompts.getWorkspaces
export const createPrompt = prompts.create
export const createPromptWorkspaces = prompts.createWorkspaceLinks
export const updatePrompt = prompts.update
export const deletePrompt = prompts.remove
export const deletePromptWorkspace = prompts.removeFromWorkspace
