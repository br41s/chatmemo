import { workspaceItems } from "./workspace-items"

const models = workspaceItems("models")

export const getModelWorkspacesByModelId = models.getWorkspaces
export const createModel = models.create
export const createModelWorkspaces = models.createWorkspaceLinks
export const updateModel = models.update
export const deleteModel = models.remove
export const deleteModelWorkspace = models.removeFromWorkspace
