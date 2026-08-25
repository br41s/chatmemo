"use client"

import { Sidebar } from "@/components/sidebar/sidebar"
import { SidebarSwitcher } from "@/components/sidebar/sidebar-switcher"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import useHotkey from "@/lib/hooks/use-hotkey"
import { initialSidebarOpen, isDrawerViewport } from "@/lib/sidebar-layout"
import { cn } from "@/lib/utils"
import { ContentType } from "@/types"
import { IconChevronCompactRight, IconX } from "@tabler/icons-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CSSProperties, FC, useEffect, useRef, useState } from "react"
import { useSelectFileHandler } from "../chat/chat-hooks/use-select-file-handler"
import { CommandK } from "../utility/command-k"

/** The sidebar's width once there is room to put it beside the chat. */
export const SIDEBAR_WIDTH = 350

const SIDEBAR_ID = "workspace-sidebar"
const CONVERSATION_ID = "conversation"

interface DashboardProps {
  children: React.ReactNode
}

export const Dashboard: FC<DashboardProps> = ({ children }) => {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabValue = searchParams.get("tab") || "chats"

  const { handleSelectDeviceFile } = useSelectFileHandler()

  const [contentType, setContentType] = useState<ContentType>(
    tabValue as ContentType
  )
  const [showSidebar, setShowSidebar] = useState(() =>
    initialSidebarOpen(
      isDrawerViewport(),
      typeof window === "undefined" ? null : localStorage.getItem("showSidebar")
    )
  )
  const [isDragging, setIsDragging] = useState(false)

  const sidebarRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(showSidebar)

  const setSidebarOpen = (open: boolean) => {
    setShowSidebar(open)
    localStorage.setItem("showSidebar", String(open))
  }

  useHotkey("s", () => setSidebarOpen(!showSidebar))

  // Escape closes the drawer, and only the drawer: on a wide screen the sidebar
  // is a column of the layout, and having Escape collapse it would be a
  // surprise rather than a dismissal.
  useEffect(() => {
    if (!showSidebar) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isDrawerViewport()) setSidebarOpen(false)
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showSidebar])

  // Opening the drawer moves focus into it; closing hands focus back to the
  // control that opened it. Without this a keyboard user has to tab through the
  // whole conversation underneath to reach the thing that just appeared over
  // it, and lands nowhere in particular when it goes away.
  useEffect(() => {
    if (isDrawerViewport()) {
      if (showSidebar) {
        sidebarRef.current?.focus()
      } else if (wasOpen.current) {
        toggleRef.current?.focus()
      }
    }

    wasOpen.current = showSidebar
  }, [showSidebar])

  const onFileDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()

    const files = event.dataTransfer.files
    const file = files[0]

    handleSelectDeviceFile(file)

    setIsDragging(false)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const onDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
  }

  return (
    <div className="flex size-full">
      <CommandK />

      <a
        href={`#${CONVERSATION_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to conversation
      </a>

      {showSidebar && (
        <>
          {/* Dims the conversation behind the drawer and closes it on a tap.
              Hidden from assistive tech: the labelled close button beside it
              is the control, this is the affordance. */}
          <div
            className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm sm:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />

          <Button
            className="fixed right-2 top-2 z-40 sm:hidden"
            variant="ghost"
            size="icon"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <IconX size={20} />
          </Button>

          <nav
            id={SIDEBAR_ID}
            ref={sidebarRef}
            tabIndex={-1}
            aria-label="Workspace"
            style={{ "--sidebar-width": `${SIDEBAR_WIDTH}px` } as CSSProperties}
            className={cn(
              "shrink-0 border-r-2 bg-background outline-none dark:border-none",
              // Under `sm` the sidebar floats over the conversation. As a
              // column it was a fixed 350px, which left roughly 25px of a 375px
              // phone for the chat itself; the drawer leaves a strip of the
              // conversation visible instead, which is what makes it read as
              // dismissable.
              "fixed inset-y-0 left-0 z-40 w-[85%] max-w-[var(--sidebar-width)]",
              "sm:static sm:z-auto sm:w-[var(--sidebar-width)] sm:max-w-none"
            )}
          >
            <Tabs
              className="flex h-full"
              value={contentType}
              onValueChange={tabValue => {
                setContentType(tabValue as ContentType)
                router.replace(`${pathname}?tab=${tabValue}`)
              }}
            >
              <SidebarSwitcher onContentTypeChange={setContentType} />

              <Sidebar contentType={contentType} />
            </Tabs>
          </nav>
        </>
      )}

      <main
        id={CONVERSATION_ID}
        className="relative flex min-w-0 grow flex-col bg-muted/50"
        onDrop={onFileDrop}
        onDragOver={onDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        {isDragging ? (
          <div className="flex h-full items-center justify-center bg-black/50 text-2xl text-white">
            drop file here
          </div>
        ) : (
          children
        )}

        <Button
          ref={toggleRef}
          className={cn(
            "absolute left-1 top-1/2 z-10 size-8 -translate-y-1/2 cursor-pointer transition-transform",
            showSidebar ? "rotate-180" : "rotate-0"
          )}
          variant="ghost"
          size="icon"
          aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={showSidebar}
          aria-controls={SIDEBAR_ID}
          onClick={() => setSidebarOpen(!showSidebar)}
        >
          <IconChevronCompactRight size={24} />
        </Button>
      </main>
    </div>
  )
}
