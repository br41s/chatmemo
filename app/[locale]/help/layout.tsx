import { Metadata } from "next"
import { ReactNode } from "react"

// The page itself is a client component (it has a Back control), and a
// client component cannot export metadata; the tab title comes from here.
export const metadata: Metadata = {
  title: "Help"
}

export default function HelpLayout({ children }: { children: ReactNode }) {
  return children
}
