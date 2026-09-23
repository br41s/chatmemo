import { workspaceItems } from "./workspace-items"

const collections = workspaceItems("collections")

export const getCollectionWorkspacesByCollectionId = collections.getWorkspaces
export const createCollection = collections.create
export const createCollectionWorkspaces = collections.createWorkspaceLinks
export const updateCollection = collections.update
export const deleteCollection = collections.remove
export const deleteCollectionWorkspace = collections.removeFromWorkspace
