"use client"

import { IconMoon, IconSun } from "@tabler/icons-react"
import { useTheme } from "next-themes"
import { FC, useEffect, useState } from "react"

interface ThemeSwitcherProps {
  size?: number
}

/**
 * Light or dark, one click.
 *
 * It lived only inside profile settings, three clicks away from the chat.
 * It sits in the rail now, and shows the theme a click would switch to —
 * a sun in the dark — the way a light switch shows what it does, not what
 * it did.
 *
 * The theme is unknown while the page is rendered on the server, so the
 * icon waits for the browser: rendering a guess and correcting it after
 * hydration was a mismatch on every load.
 */
export const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ size = 28 }) => {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const dark = resolvedTheme === "dark"
  const next = dark ? "light" : "dark"

  return (
    <button
      type="button"
      aria-label={mounted ? `Switch to ${next} theme` : "Switch theme"}
      className="flex h-[55px] w-full cursor-pointer items-center justify-center hover:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => setTheme(next)}
    >
      {mounted && (dark ? <IconSun size={size} /> : <IconMoon size={size} />)}
    </button>
  )
}
