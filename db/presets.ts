import { workspaceItems } from "./workspace-items"

const presets = workspaceItems("presets")

export const getPresetWorkspacesByPresetId = presets.getWorkspaces
export const createPreset = presets.create
export const createPresetWorkspaces = presets.createWorkspaceLinks
export const updatePreset = presets.update
export const deletePreset = presets.remove
export const deletePresetWorkspace = presets.removeFromWorkspace
