import { MONTHS } from "./dates"
import { STOP } from "./stopwords"

// What in a message is worth searching for.
//
// Two readings, strongest first: what the person quoted, then what is left once
// dates and filler are stripped out.

// ---------------------------------------------------------------------------
// Quoted-title extraction (strongest signal — user usually quotes the title)
// ---------------------------------------------------------------------------

/**
 * Pull quoted phrases from the message. Handles straight and curly quotes.
 * Each phrase is trimmed at the first comma so it stays safe to use as a
 * single ILIKE substring (the stored title still contains the full text, and
 * ILIKE matches the comma-free prefix).
 */
export function extractQuotedPhrases(message: string): string[] {
  const phrases: string[] = []
  const re = /["“”'']([^"“”'']{4,})["“”'']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const raw = m[1].trim()
    const prefix = raw.split(",")[0].trim()
    if (prefix.length >= 4) phrases.push(prefix)
  }
  return phrases
}

// ---------------------------------------------------------------------------
// Topic extraction (fallback when the user didn't quote a title)
// ---------------------------------------------------------------------------

export function extractTopicWords(message: string): string[] {
  const monthPattern = new RegExp(
    `\\b(${Object.keys(MONTHS).join("|")})\\b`,
    "g"
  )
  const cleaned = message
    .toLowerCase()
    .replace(/\b202\d\b/g, " ")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(monthPattern, " ")
    .replace(/[^a-z0-9áéíóúñü\s]/g, " ")

  const words = cleaned.split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))

  return [...new Set(words)].slice(0, 4)
}
