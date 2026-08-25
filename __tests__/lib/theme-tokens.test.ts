import { readFileSync } from "fs"
import { join } from "path"

const CSS = readFileSync(
  join(__dirname, "..", "..", "app", "[locale]", "globals.css"),
  "utf8"
)

const TAILWIND = readFileSync(
  join(__dirname, "..", "..", "tailwind.config.ts"),
  "utf8"
)

/** Every `--name: value` declaration inside one block of the file. */
function tokensIn(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block in globals.css`)

  // The blocks contain no nested braces, so the first closing brace ends it.
  const end = CSS.indexOf("}", start)
  const block = CSS.slice(start, end)

  const tokens = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim())
  }

  return tokens
}

const light = tokensIn(":root")
const dark = tokensIn(".dark")

describe("theme tokens", () => {
  it("defines the semantic and brand colours in light", () => {
    for (const name of [
      "--brand",
      "--brand-foreground",
      "--success",
      "--success-foreground",
      "--warning",
      "--warning-foreground",
      "--info",
      "--info-foreground",
      "--destructive",
      "--destructive-foreground",
      "--ring"
    ]) {
      expect(light.has(name)).toBe(true)
    }
  })

  it("overrides every colour token in dark", () => {
    // The bug this catches: a token added to `:root` and forgotten in `.dark`
    // silently keeps its light value on a near-black background. `--radius` is
    // the one token that is deliberately shared.
    const missing = [...light.keys()].filter(
      name => name !== "--radius" && !dark.has(name)
    )

    expect(missing).toEqual([])
  })

  it("adds no dark token that light does not define", () => {
    const orphans = [...dark.keys()].filter(name => !light.has(name))

    expect(orphans).toEqual([])
  })

  it("states every colour as bare HSL channels, not a colour function", () => {
    // Tailwind wraps these as `hsl(var(--x))` so the `/50` opacity modifier can
    // work. A token written as `#fff` or `hsl(...)` compiles to an invalid
    // declaration only at the point of use, which is easy to miss.
    for (const [name, value] of [...light, ...dark]) {
      if (name === "--radius") continue

      expect([name, value]).toEqual([
        name,
        expect.stringMatching(/^[\d.]+ [\d.]+% [\d.]+%$/)
      ])
    }
  })

  it("registers every colour Tailwind exposes against a defined token", () => {
    for (const match of TAILWIND.matchAll(/hsl\(var\((--[\w-]+)\)\)/g)) {
      expect(light.has(match[1])).toBe(true)
    }
  })
})
