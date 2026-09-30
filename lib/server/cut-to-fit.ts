// Filling a memory layer to its allowance.
//
// The layers admitted entries all-or-nothing: the first one that did not fit
// ended the layer. With allowances generous enough that was invisible. On a
// small window it turned "does not fit" into "does not exist" — a recovered
// conversation longer than the allowance was reported to the model and to the
// person as "no matching conversation found", and the relevance layer went
// silent whenever its best match was a long row.
//
// So the first entry of a layer is cut to what there is, and says it was cut.
// Only the first: once a layer has something in it, a further entry that does
// not fit is left out whole, as before.

/** Below this, a cut entry says too little to be worth its place. */
export const MIN_CUT_CHARS = 200

/**
 * `text` within `maxChars`, cut from the end with `note` appended when it is
 * too long. Null when the room left is too small to be useful. Never returns
 * more than `maxChars`.
 */
export function cutToFit(
  text: string,
  maxChars: number,
  note = "…"
): string | null {
  if (text.length <= maxChars) return text
  if (maxChars < MIN_CUT_CHARS) return null

  let head = text.slice(0, maxChars - note.length)
  // Not through the middle of a surrogate pair.
  const last = head.charCodeAt(head.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1)
  return head.trimEnd() + note
}

/**
 * The entries that fit `allowance`, in order. If not even the first fits, it
 * is cut to the allowance rather than leaving the layer empty.
 */
export function fillLayer(
  entries: string[],
  allowance: number,
  note = "…"
): string[] {
  const admitted: string[] = []
  let used = 0
  for (const entry of entries) {
    if (used + entry.length > allowance) {
      if (admitted.length === 0) {
        const cut = cutToFit(entry, allowance, note)
        if (cut) admitted.push(cut)
      }
      break
    }
    admitted.push(entry)
    used += entry.length
  }
  return admitted
}
