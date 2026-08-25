import { ChatbotUIContext } from "@/context/context"
import { Tables } from "@/supabase/types"
import { ContentType } from "@/types"
import { FC, useContext } from "react"
import { TabsContent } from "../ui/tabs"
import { WorkspaceSwitcher } from "../utility/workspace-switcher"
import { WorkspaceSettings } from "../workspace/workspace-settings"
import { SidebarContent } from "./sidebar-content"

interface SidebarProps {
  contentType: ContentType
}

export const Sidebar: FC<SidebarProps> = ({ contentType }) => {
  const {
    folders,
    chats,
    presets,
    prompts,
    files,
    collections,
    assistants,
    tools,
    models
  } = useContext(ChatbotUIContext)

  const chatFolders = folders.filter(folder => folder.type === "chats")
  const presetFolders = folders.filter(folder => folder.type === "presets")
  const promptFolders = folders.filter(folder => folder.type === "prompts")
  const filesFolders = folders.filter(folder => folder.type === "files")
  const collectionFolders = folders.filter(
    folder => folder.type === "collections"
  )
  const assistantFolders = folders.filter(
    folder => folder.type === "assistants"
  )
  const toolFolders = folders.filter(folder => folder.type === "tools")
  const modelFolders = folders.filter(folder => folder.type === "models")

  const renderSidebarContent = (
    contentType: ContentType,
    data: any[],
    folders: Tables<"folders">[]
  ) => {
    return (
      <SidebarContent contentType={contentType} data={data} folders={folders} />
    )
  }

  return (
    // Takes whatever the icon rail leaves rather than a width computed from a
    // hardcoded sidebar constant: the sidebar is a percentage of the viewport
    // on a phone, so `SIDEBAR_WIDTH - 60px` was the wrong number there and
    // pushed the content past the edge of its own container.
    <TabsContent className="m-0 min-w-0 flex-1 space-y-2" value={contentType}>
      <div className="flex h-full flex-col p-3">
        <div className="flex items-center border-b-2 pb-2">
          <WorkspaceSwitcher />

          <WorkspaceSettings />
        </div>

        {(() => {
          switch (contentType) {
            case "chats":
              return renderSidebarContent("chats", chats, chatFolders)

            case "presets":
              return renderSidebarContent("presets", presets, presetFolders)

            case "prompts":
              return renderSidebarContent("prompts", prompts, promptFolders)

            case "files":
              return renderSidebarContent("files", files, filesFolders)

            case "collections":
              return renderSidebarContent(
                "collections",
                collections,
                collectionFolders
              )

            case "assistants":
              return renderSidebarContent(
                "assistants",
                assistants,
                assistantFolders
              )

            case "tools":
              return renderSidebarContent("tools", tools, toolFolders)

            case "models":
              return renderSidebarContent("models", models, modelFolders)

            default:
              return null
          }
        })()}
      </div>
    </TabsContent>
  )
}
