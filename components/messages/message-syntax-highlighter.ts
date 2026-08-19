// Prism, with only the grammars this app actually renders.
//
// The default `Prism` export of react-syntax-highlighter bundles ~300 language
// grammars plus the refractor core, and it was imported statically into the
// chat route — the heaviest single contributor to that route's First Load JS.
// `prism-light` ships the core alone and lets us register what we need.
//
// An unregistered language degrades to unhighlighted text rather than
// throwing, so the cost of a missing grammar is cosmetic.

import { PrismLight } from "react-syntax-highlighter"

import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash"
import c from "react-syntax-highlighter/dist/esm/languages/prism/c"
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp"
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp"
import css from "react-syntax-highlighter/dist/esm/languages/prism/css"
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff"
import go from "react-syntax-highlighter/dist/esm/languages/prism/go"
import haskell from "react-syntax-highlighter/dist/esm/languages/prism/haskell"
import java from "react-syntax-highlighter/dist/esm/languages/prism/java"
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript"
import json from "react-syntax-highlighter/dist/esm/languages/prism/json"
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx"
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin"
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua"
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown"
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup"
import objectivec from "react-syntax-highlighter/dist/esm/languages/prism/objectivec"
import perl from "react-syntax-highlighter/dist/esm/languages/prism/perl"
import php from "react-syntax-highlighter/dist/esm/languages/prism/php"
import python from "react-syntax-highlighter/dist/esm/languages/prism/python"
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby"
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust"
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala"
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql"
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift"
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx"
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript"
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml"

// The fence label the model writes → the Prism grammar name. Aliases that
// differ from the grammar's own name are listed explicitly; everything else
// registers under its own name.
const GRAMMARS = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  haskell,
  java,
  javascript,
  json,
  jsx,
  kotlin,
  lua,
  markdown,
  markup,
  objectivec,
  perl,
  php,
  python,
  ruby,
  rust,
  scala,
  sql,
  swift,
  tsx,
  typescript,
  yaml
} as const

const ALIASES: Record<string, keyof typeof GRAMMARS> = {
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  "objective-c": "objectivec",
  html: "markup",
  xml: "markup",
  svg: "markup",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  yml: "yaml",
  md: "markdown"
}

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  PrismLight.registerLanguage(name, grammar)
}

for (const [alias, target] of Object.entries(ALIASES)) {
  PrismLight.registerLanguage(alias, GRAMMARS[target])
}

export { PrismLight as SyntaxHighlighter }
