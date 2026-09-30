/**
 * @jest-environment node
 *
 * The shortcut list shown to people is the list of shortcuts that exist.
 *
 * Reads the components for `useHotkey("…")` calls rather than trusting a
 * second list: the help popover had drifted two entries behind the code.
 */
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { SHORTCUTS } from "@/lib/shortcuts"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

const registered = new Set<string>()
for (const dir of ["components", "app"]) {
  for (const file of sourceFiles(join(process.cwd(), dir))) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /useHotkey\("([^"]+)"/g
    )) {
      registered.add(match[1])
    }
  }
}

it("lists every registered hotkey, and nothing else", () => {
  const listed = new Set(SHORTCUTS.map(shortcut => shortcut.key))
  expect([...listed].sort()).toEqual([...registered].sort())
})

it("describes each one", () => {
  for (const shortcut of SHORTCUTS) {
    expect(shortcut.does.length).toBeGreaterThan(3)
  }
})
