import useHotkey from "@/lib/hooks/use-hotkey"
import { SHORTCUTS } from "@/lib/shortcuts"
import {
  IconBrandGithub,
  IconHelpCircle,
  IconQuestionMark
} from "@tabler/icons-react"
import Link from "next/link"
import { FC, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu"

interface ChatHelpProps {}

export const ChatHelp: FC<ChatHelpProps> = ({}) => {
  useHotkey("/", () => setIsOpen(prevState => !prevState))

  const [isOpen, setIsOpen] = useState(false)

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <IconQuestionMark className="size-[24px] cursor-pointer rounded-full bg-primary p-0.5 text-secondary opacity-60 hover:opacity-50 lg:size-[30px] lg:p-1" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex items-center justify-between">
          <div className="flex space-x-2">
            <Link
              className="cursor-pointer hover:opacity-50"
              href="https://github.com/br41s/chatmemo"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ChatMemo on GitHub"
            >
              <IconBrandGithub />
            </Link>
          </div>

          <div className="flex space-x-2">
            <Link
              className="cursor-pointer hover:opacity-50"
              href="/help"
              aria-label="Help"
            >
              <IconHelpCircle size={24} />
            </Link>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />
        {SHORTCUTS.map(({ key, label, does }) => (
          <DropdownMenuItem
            key={key}
            className="flex w-[300px] justify-between"
          >
            <div>{does}</div>
            <div className="flex opacity-60">
              {["⌘", "Shift", label ?? key].map(part => (
                <div
                  key={part}
                  className="min-w-[30px] rounded border-DEFAULT p-1 text-center"
                >
                  {part}
                </div>
              ))}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
