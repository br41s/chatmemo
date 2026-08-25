// A bounded, version-keyed cache.
//
// Used for the baseline memory blob, which is rebuilt on every chat turn even
// though it only changes when the user writes a summary or their lessons are
// rewritten. Caching it on a timer would mean serving memory that is knowably
// stale — the summary written after the previous turn would be missing from
// the next one, on the feature the product exists for.
//
// So entries are keyed by a version the caller reads from the database. A hit
// requires the version to match exactly, which makes staleness impossible
// rather than unlikely: a stale entry cannot be returned, only missed. That
// also means several server instances need no coordination — each validates
// against the same source of truth.
//
// Correctness never depends on a hit. A miss does the full work.

interface Entry<T> {
  version: string
  value: T
}

export class VersionedCache<T> {
  private entries = new Map<string, Entry<T>>()

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) throw new Error("maxEntries must be at least 1")
  }

  /**
   * The cached value for `key`, but only if it was stored under exactly this
   * version. Returns undefined on a miss — which is distinct from a cached
   * null, since "this user has no memory" is itself worth not recomputing.
   */
  get(key: string, version: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry || entry.version !== version) return undefined

    // Refresh recency: re-inserting moves the key to the end of the Map's
    // insertion order, which is what eviction reads.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, version: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, { version, value })

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  /** Test seam. */
  get size(): number {
    return this.entries.size
  }

  /** Test seam. */
  clear(): void {
    this.entries.clear()
  }
}
