// The keyboard shortcuts the app registers, in one place.
//
// The help popover and the help page both list them, and each used to carry
// its own copy; the popover's had fallen two short. Every entry is ⌘ ⇧ plus
// the key — `lib/hooks/use-hotkey.tsx` requires both modifiers — and the test
// in __tests__/lib/shortcuts.test.ts checks this list against the `useHotkey`
// calls in the components, so adding a hotkey without listing it fails.

export interface Shortcut {
  /** The key as `useHotkey` registers it. */
  key: string
  /** The key as shown, where the registered name is not what is printed. */
  label?: string
  /** What it does, as a short phrase. */
  does: string
}

export const SHORTCUTS: Shortcut[] = [
  { key: "o", label: "O", does: "New chat" },
  { key: "l", label: "L", does: "Focus the composer" },
  { key: "k", label: "K", does: "Command palette" },
  { key: "s", label: "S", does: "Show or hide the sidebar" },
  { key: "i", label: "I", does: "Chat settings" },
  { key: "p", label: "P", does: "Quick settings" },
  { key: "f", label: "F", does: "Show or hide the chat's files" },
  { key: "e", label: "E", does: "Turn file retrieval on or off" },
  { key: "Backspace", label: "⌫", does: "Delete the current chat" },
  { key: ";", does: "Workspaces" },
  { key: "/", does: "Shortcut list" }
]
