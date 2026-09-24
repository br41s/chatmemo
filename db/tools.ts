import { workspaceItems } from "./workspace-items"

const tools = workspaceItems("tools")

export const getToolWorkspacesByToolId = tools.getWorkspaces
export const createTool = tools.create
export const createToolWorkspaces = tools.createWorkspaceLinks
export const updateTool = tools.update
export const deleteTool = tools.remove
export const deleteToolWorkspace = tools.removeFromWorkspace
