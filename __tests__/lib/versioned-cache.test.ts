/**
 * Tests for lib/server/versioned-cache.ts — the cache behind the baseline
 * memory blob.
 *
 * The property that matters is that a stale entry can never be returned. The
 * blob is what the model is told about the user, so serving a version behind
 * would mean answering from memory the user has already changed.
 */
import { VersionedCache } from "@/lib/server/versioned-cache"

describe("VersionedCache", () => {
  it("returns a value stored under the same version", () => {
    const cache = new VersionedCache<string>(10)
    cache.set("user-1", "v1", "blob")
    expect(cache.get("user-1", "v1")).toBe("blob")
  })

  it("misses when the version moved on, rather than serving the old value", () => {
    const cache = new VersionedCache<string>(10)
    cache.set("user-1", "v1", "old blob")
    expect(cache.get("user-1", "v2")).toBeUndefined()
  })

  it("keeps users apart", () => {
    const cache = new VersionedCache<string>(10)
    cache.set("user-1", "v1", "one")
    cache.set("user-2", "v1", "two")
    expect(cache.get("user-1", "v1")).toBe("one")
    expect(cache.get("user-2", "v1")).toBe("two")
  })

  it("distinguishes a cached null from a miss", () => {
    // "This user has no memory yet" is a real answer worth caching; it must not
    // read as an absent entry and trigger the full rebuild every turn.
    const cache = new VersionedCache<string | null>(10)
    cache.set("user-1", "v1", null)
    expect(cache.get("user-1", "v1")).toBeNull()
    expect(cache.get("user-1", "v9")).toBeUndefined()
  })

  it("replaces the entry when the same key is stored at a new version", () => {
    const cache = new VersionedCache<string>(10)
    cache.set("user-1", "v1", "old")
    cache.set("user-1", "v2", "new")
    expect(cache.get("user-1", "v2")).toBe("new")
    expect(cache.get("user-1", "v1")).toBeUndefined()
    expect(cache.size).toBe(1)
  })
})

describe("VersionedCache — bounds", () => {
  it("never grows past maxEntries", () => {
    const cache = new VersionedCache<number>(3)
    for (let i = 0; i < 50; i++) cache.set(`user-${i}`, "v1", i)
    expect(cache.size).toBe(3)
  })

  it("evicts the least recently used entry", () => {
    const cache = new VersionedCache<number>(3)
    cache.set("a", "v1", 1)
    cache.set("b", "v1", 2)
    cache.set("c", "v1", 3)

    // Touch "a" so "b" becomes the oldest.
    expect(cache.get("a", "v1")).toBe(1)

    cache.set("d", "v1", 4)

    expect(cache.get("b", "v1")).toBeUndefined()
    expect(cache.get("a", "v1")).toBe(1)
    expect(cache.get("c", "v1")).toBe(3)
    expect(cache.get("d", "v1")).toBe(4)
  })

  it("rejects a nonsensical bound instead of caching nothing silently", () => {
    expect(() => new VersionedCache(0)).toThrow()
  })
})
