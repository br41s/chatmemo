// ---------------------------------------------------------------------------
// RecursiveCharacterTextSplitter — vendored from langchain@0.0.213
// (MIT license), trimmed to the subset the retrieval pipeline uses.
//
// langchain was the project's largest source of vulnerable transitive
// dependencies while only this splitter and three thin file loaders were
// actually used. The splitting algorithm below is a faithful port: same
// separators, same keepSeparator=true default, same merge/overlap behavior,
// so existing stored chunks and new ones stay consistent.
// ---------------------------------------------------------------------------

interface SplitterOptions {
  chunkSize?: number
  chunkOverlap?: number
  separators?: string[]
  keepSeparator?: boolean
}

const MARKDOWN_SEPARATORS = [
  // Headings (level 2+), end of code blocks, horizontal rules, then text
  "\n## ",
  "\n### ",
  "\n#### ",
  "\n##### ",
  "\n###### ",
  "```\n\n",
  "\n\n***\n\n",
  "\n\n---\n\n",
  "\n\n___\n\n",
  "\n\n",
  "\n",
  " ",
  ""
]

export class RecursiveCharacterTextSplitter {
  private chunkSize: number
  private chunkOverlap: number
  private separators: string[]
  private keepSeparator: boolean

  constructor(options: SplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1000
    this.chunkOverlap = options.chunkOverlap ?? 200
    this.separators = options.separators ?? ["\n\n", "\n", " ", ""]
    this.keepSeparator = options.keepSeparator ?? true
    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error("Cannot have chunkOverlap >= chunkSize")
    }
  }

  static fromLanguage(
    language: "markdown",
    options: SplitterOptions = {}
  ): RecursiveCharacterTextSplitter {
    if (language !== "markdown") {
      throw new Error(`Unsupported splitter language: ${language}`)
    }
    return new RecursiveCharacterTextSplitter({
      ...options,
      separators: MARKDOWN_SEPARATORS
    })
  }

  splitText(text: string): string[] {
    return this._splitText(text, this.separators)
  }

  private _splitText(text: string, separators: string[]): string[] {
    const finalChunks: string[] = []

    let separator = separators[separators.length - 1]
    let newSeparators: string[] | undefined
    for (let i = 0; i < separators.length; i += 1) {
      const s = separators[i]
      if (s === "") {
        separator = s
        break
      }
      if (text.includes(s)) {
        separator = s
        newSeparators = separators.slice(i + 1)
        break
      }
    }

    const splits = this.splitOnSeparator(text, separator)

    let goodSplits: string[] = []
    const mergeSeparator = this.keepSeparator ? "" : separator
    for (const s of splits) {
      if (s.length < this.chunkSize) {
        goodSplits.push(s)
      } else {
        if (goodSplits.length) {
          finalChunks.push(...this.mergeSplits(goodSplits, mergeSeparator))
          goodSplits = []
        }
        if (!newSeparators) {
          finalChunks.push(s)
        } else {
          finalChunks.push(...this._splitText(s, newSeparators))
        }
      }
    }
    if (goodSplits.length) {
      finalChunks.push(...this.mergeSplits(goodSplits, mergeSeparator))
    }
    return finalChunks
  }

  private splitOnSeparator(text: string, separator: string): string[] {
    let splits: string[]
    if (separator) {
      if (this.keepSeparator) {
        const escaped = separator.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")
        splits = text.split(new RegExp(`(?=${escaped})`))
      } else {
        splits = text.split(separator)
      }
    } else {
      splits = text.split("")
    }
    return splits.filter(s => s !== "")
  }

  private mergeSplits(splits: string[], separator: string): string[] {
    const docs: string[] = []
    const currentDoc: string[] = []
    let total = 0
    for (const d of splits) {
      const len = d.length
      if (
        total + len + (currentDoc.length > 0 ? separator.length : 0) >
        this.chunkSize
      ) {
        if (currentDoc.length > 0) {
          const doc = this.joinDocs(currentDoc, separator)
          if (doc !== null) {
            docs.push(doc)
          }
          // Pop from the front until we are under the overlap budget and the
          // next split fits — same backoff loop as upstream.
          while (
            total > this.chunkOverlap ||
            (total + len > this.chunkSize && total > 0)
          ) {
            total -= currentDoc[0].length
            currentDoc.shift()
          }
        }
      }
      currentDoc.push(d)
      total += len
    }
    const doc = this.joinDocs(currentDoc, separator)
    if (doc !== null) {
      docs.push(doc)
    }
    return docs
  }

  private joinDocs(docs: string[], separator: string): string | null {
    const text = docs.join(separator).trim()
    return text === "" ? null : text
  }
}
