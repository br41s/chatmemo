import { ContentType } from "@/types"
import {
  IconAdjustmentsHorizontal,
  IconBolt,
  IconBooks,
  IconDots,
  IconFile,
  IconMessage,
  IconPencil,
  IconRobotFace,
  IconSparkles
} from "@tabler/icons-react"
import { FC, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { TabsList } from "../ui/tabs"
import { WithTooltip } from "../ui/with-tooltip"
import { MemoryHistorySheet } from "../memory/memory-history-sheet"
import { TimelineSheet } from "../timeline/timeline-sheet"
import { ProfileSettings } from "../utility/profile-settings"
import { SidebarSwitchItem } from "./sidebar-switch-item"

export const SIDEBAR_ICON_SIZE = 28

/** One rail cell: the tabs, the sheet triggers and the "more" button share
 *  it so the column reads as one list rather than two. */
export const RAIL_CELL = "flex h-[55px] w-full items-center justify-center"

/**
 * The upstream tabs that are configuration rather than daily use. They keep
 * their tab semantics behind one "More" cell instead of each taking a row,
 * which is what let the memory features sit at the top where the product
 * says they are.
 */
const MORE_TABS: ContentType[] = [
  "presets",
  "models",
  "collections",
  "assistants",
  "tools"
]

interface SidebarSwitcherProps {
  contentType: ContentType
  onContentTypeChange: (contentType: ContentType) => void
}

export const SidebarSwitcher: FC<SidebarSwitcherProps> = ({
  contentType,
  onContentTypeChange
}) => {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE_TABS.includes(contentType)

  const pickMore = (type: ContentType) => {
    onContentTypeChange(type)
    setMoreOpen(false)
  }

  return (
    <div className="flex flex-col justify-between border-r pb-5">
      <div className="flex flex-col">
        {/* Memory first: the two views this product exists for sit right
            under the conversations, not at the bottom behind the settings. */}
        <TabsList className="grid h-auto auto-rows-[55px] grid-cols-1 bg-background">
          <SidebarSwitchItem
            icon={<IconMessage size={SIDEBAR_ICON_SIZE} />}
            contentType="chats"
            onContentTypeChange={onContentTypeChange}
          />
        </TabsList>
        <WithTooltip
          display={<div>Conversation timeline</div>}
          trigger={<TimelineSheet />}
        />
        <WithTooltip
          display={<div>Memory</div>}
          trigger={<MemoryHistorySheet />}
        />

        <div className="mx-3 my-2 border-t" />

        <TabsList className="grid h-auto auto-rows-[55px] grid-cols-1 bg-background">
          <SidebarSwitchItem
            icon={<IconPencil size={SIDEBAR_ICON_SIZE} />}
            contentType="prompts"
            onContentTypeChange={onContentTypeChange}
          />
          <SidebarSwitchItem
            icon={<IconFile size={SIDEBAR_ICON_SIZE} />}
            contentType="files"
            onContentTypeChange={onContentTypeChange}
          />
        </TabsList>

        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <WithTooltip
            display={<div>Presets, models, collections, assistants, tools</div>}
            trigger={
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  aria-expanded={moreOpen}
                  className={`${RAIL_CELL} hover:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    moreActive ? "text-brand" : ""
                  }`}
                >
                  <IconDots size={SIDEBAR_ICON_SIZE} />
                </button>
              </PopoverTrigger>
            }
          />
          <PopoverContent side="right" align="start" className="w-auto p-1">
            {/* A second tab list, so the hidden tabs keep their roving focus
                and selected state without a row each in the rail. */}
            <TabsList className="grid h-auto auto-rows-[44px] grid-cols-1 bg-transparent">
              <SidebarSwitchItem
                icon={<IconAdjustmentsHorizontal size={22} />}
                contentType="presets"
                onContentTypeChange={pickMore}
              />
              <SidebarSwitchItem
                icon={<IconSparkles size={22} />}
                contentType="models"
                onContentTypeChange={pickMore}
              />
              <SidebarSwitchItem
                icon={<IconBooks size={22} />}
                contentType="collections"
                onContentTypeChange={pickMore}
              />
              <SidebarSwitchItem
                icon={<IconRobotFace size={22} />}
                contentType="assistants"
                onContentTypeChange={pickMore}
              />
              <SidebarSwitchItem
                icon={<IconBolt size={22} />}
                contentType="tools"
                onContentTypeChange={pickMore}
              />
            </TabsList>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col items-center">
        <WithTooltip
          display={<div>Profile settings</div>}
          trigger={<ProfileSettings />}
        />
      </div>
    </div>
  )
}
