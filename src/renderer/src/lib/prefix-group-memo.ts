export type PrefixGrouping<T, G> = {
  /**
   * Groups `items[startIndex..]`. `ends[i]` is the exclusive end index of
   * `groups[i]` within `items`.
   */
  groupFrom: (items: readonly T[], startIndex: number) => { groups: G[]; ends: number[] }
  /** Whether `item` begins a new group (e.g. a user message starts a new turn). */
  startsGroup: (item: T) => boolean
}

/**
 * Memoizes a grouping over an append-mostly list. Between calls, items are
 * compared by object identity; groups that end at or before a group-start
 * boundary inside the unchanged prefix are reused by reference and only the
 * tail is regrouped. A group is never reused past a boundary-aligned cut,
 * because an open group may absorb appended items.
 */
export function createPrefixGroupMemo<T, G>(grouping: PrefixGrouping<T, G>): (items: T[]) => G[] {
  let cachedItems: readonly T[] | null = null
  let cachedGroups: G[] = []
  let cachedEnds: number[] = []

  return (items: T[]): G[] => {
    if (items === cachedItems) return cachedGroups

    let prefix = 0
    if (cachedItems) {
      const limit = Math.min(items.length, cachedItems.length)
      while (prefix < limit && items[prefix] === cachedItems[prefix]) prefix += 1
    }
    // Align the reuse cut to a group boundary inside the unchanged prefix:
    // groups ending here are identical in the fresh grouping, everything from
    // the cut on is regrouped.
    let cut = prefix
    while (cut > 0 && (cut >= items.length || !grouping.startsGroup(items[cut]))) cut -= 1

    let reuseCount = 0
    while (reuseCount < cachedEnds.length && cachedEnds[reuseCount] <= cut) reuseCount += 1

    const suffix = grouping.groupFrom(items, cut)
    const groups = reuseCount > 0
      ? [...cachedGroups.slice(0, reuseCount), ...suffix.groups]
      : suffix.groups
    cachedItems = items
    cachedGroups = groups
    cachedEnds = reuseCount > 0 ? [...cachedEnds.slice(0, reuseCount), ...suffix.ends] : suffix.ends
    return groups
  }
}
