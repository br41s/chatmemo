// Working out what a Save actually has to write.
//
// sidebar-update-item.tsx computed this inline five times — once for
// workspaces, then again for collection files, assistant files, assistant
// collections and assistant tools — under two different meanings of the word
// "selected", one of which reads like a bug and is not.

export interface Identified {
  id: string
}

export interface LinkChanges<T> {
  toAdd: T[]
  toRemove: T[]
}

/**
 * Changes when the second list is a **toggle log**, not a desired state.
 *
 * The link pickers report what the person clicked, not what they want to end up
 * with: an id present in both lists was clicked *off*, so it is a removal. That
 * makes the removal test look inverted next to `resolveSelection` below —
 * `starting.filter(item => toggled.some(...))` reads like "keep what is
 * selected" and means "remove what was un-selected". It was written inline four
 * times, so getting it wrong once would have been easy and silent.
 */
export function resolveToggles<T extends Identified>(
  starting: T[],
  toggled: T[]
): LinkChanges<T> {
  return {
    toAdd: toggled.filter(
      candidate => !starting.some(existing => existing.id === candidate.id)
    ),
    toRemove: starting.filter(existing =>
      toggled.some(candidate => candidate.id === existing.id)
    )
  }
}

/**
 * Changes when the second list is the **desired state**.
 *
 * The workspace picker keeps a full list — it starts as what is assigned and
 * each click adds or drops one — so anything missing from it is a removal.
 */
export function resolveSelection<T extends Identified>(
  starting: T[],
  selected: T[]
): LinkChanges<T> {
  return {
    toAdd: selected.filter(
      candidate => !starting.some(existing => existing.id === candidate.id)
    ),
    toRemove: starting.filter(
      existing => !selected.some(candidate => candidate.id === existing.id)
    )
  }
}

/** Add it if it is missing, drop it if it is there. */
export function toggleInList<T extends Identified>(list: T[], item: T): T[] {
  return list.some(existing => existing.id === item.id)
    ? list.filter(existing => existing.id !== item.id)
    : [...list, item]
}

/**
 * "collections" to "collection", for a heading and a toast.
 *
 * Every content type this component handles is a plural formed with a trailing
 * "s", so trimming one character is enough — and it is what the component did
 * inline, three times.
 */
export function singularize(contentType: string): string {
  return contentType.endsWith("s") ? contentType.slice(0, -1) : contentType
}
