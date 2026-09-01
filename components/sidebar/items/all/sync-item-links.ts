import { Identified, resolveToggles } from "@/lib/sidebar-item-links"

/**
 * Bring a set of links in line with what was clicked.
 *
 * The same fourteen lines appeared four times — collection files, assistant
 * files, assistant collections, assistant tools — differing only in which
 * create and delete call they made.
 */
export async function syncItemLinks<T extends Identified>({
  starting,
  toggled,
  link,
  unlink
}: {
  starting: T[]
  toggled: T[]
  link: (item: T) => Promise<unknown>
  unlink: (item: T) => Promise<unknown>
}): Promise<void> {
  const { toAdd, toRemove } = resolveToggles(starting, toggled)

  for (const item of toAdd) {
    await link(item)
  }

  for (const item of toRemove) {
    await unlink(item)
  }
}
