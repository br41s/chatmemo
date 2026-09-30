import { ContentType } from "@/types"
import { FC } from "react"
import { TabsTrigger } from "../ui/tabs"
import { WithTooltip } from "../ui/with-tooltip"

interface SidebarSwitchItemProps {
  contentType: ContentType
  icon: React.ReactNode
  /** Shown beside the icon, in place of the tooltip, where there is room. */
  label?: string
  onContentTypeChange: (contentType: ContentType) => void
}

export const SidebarSwitchItem: FC<SidebarSwitchItemProps> = ({
  contentType,
  icon,
  label,
  onContentTypeChange
}) => {
  if (label) {
    return (
      <TabsTrigger
        className="w-full justify-start gap-2 px-2 text-sm hover:opacity-50 data-[state=active]:text-brand"
        value={contentType}
        onClick={() => onContentTypeChange(contentType as ContentType)}
      >
        {icon}
        <span>{label}</span>
      </TabsTrigger>
    )
  }

  return (
    <WithTooltip
      interactive
      display={
        <div>{contentType[0].toUpperCase() + contentType.substring(1)}</div>
      }
      trigger={
        <TabsTrigger
          className="hover:opacity-50 data-[state=active]:text-brand"
          value={contentType}
          onClick={() => onContentTypeChange(contentType as ContentType)}
        >
          {icon}
        </TabsTrigger>
      }
    />
  )
}
