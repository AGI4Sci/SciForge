import { describe, expect, it } from 'vitest'
import { createPrefixGroupMemo } from './prefix-group-memo'

type Item = { id: string; user?: boolean }
type Group = { items: Item[] }

function groupFrom(items: readonly Item[], startIndex: number): { groups: Group[]; ends: number[] } {
  const groups: Group[] = []
  const ends: number[] = []
  let current: Group | null = null
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index]
    if (item.user) {
      if (current) {
        groups.push(current)
        ends.push(index)
      }
      current = { items: [item] }
      continue
    }
    if (!current) current = { items: [] }
    current.items.push(item)
  }
  if (current) {
    groups.push(current)
    ends.push(items.length)
  }
  return { groups, ends }
}

function makeMemo(): (items: Item[]) => Group[] {
  return createPrefixGroupMemo<Item, Group>({
    groupFrom,
    startsGroup: (item) => item.user === true
  })
}

function groupIds(groups: Group[]): string[][] {
  return groups.map((group) => group.items.map((item) => item.id))
}

describe('prefix group memo', () => {
  it('returns the same array when the list reference is unchanged', () => {
    const memo = makeMemo()
    const items: Item[] = [{ id: 'u1', user: true }, { id: 'a1' }]
    const first = memo(items)
    expect(memo(items)).toBe(first)
  })

  it('regroups from scratch when the prefix changes', () => {
    const memo = makeMemo()
    const first = memo([{ id: 'u1', user: true }, { id: 'a1' }])
    const second = memo([{ id: 'u2', user: true }, { id: 'a1' }])
    expect(groupIds(second)).toEqual([['u2', 'a1']])
    expect(second[0]).not.toBe(first[0])
  })

  it('reuses prefix groups by reference when a group starts right at the append point', () => {
    const memo = makeMemo()
    const u1: Item = { id: 'u1', user: true }
    const a1: Item = { id: 'a1' }
    const first = memo([u1, a1])
    const u2: Item = { id: 'u2', user: true }
    const second = memo([u1, a1, u2])

    expect(groupIds(second)).toEqual([['u1', 'a1'], ['u2']])
    expect(second[0]).toBe(first[0])
  })

  it('extends the open tail group instead of reusing it when appending non-boundary items', () => {
    const memo = makeMemo()
    const u1: Item = { id: 'u1', user: true }
    const a1: Item = { id: 'a1' }
    const first = memo([u1, a1])
    const t1: Item = { id: 't1' }
    const second = memo([u1, a1, t1])

    // The only group absorbed the appended item, so it cannot be reused.
    expect(groupIds(second)).toEqual([['u1', 'a1', 't1']])
    expect(second[0]).not.toBe(first[0])
    expect(second[0].items[0]).toBe(u1)
  })

  it('reuses earlier groups when an item inside a later group is replaced', () => {
    const memo = makeMemo()
    const u1: Item = { id: 'u1', user: true }
    const a1: Item = { id: 'a1' }
    const u2: Item = { id: 'u2', user: true }
    const t1: Item = { id: 't1' }
    const first = memo([u1, a1, u2, t1])
    const t1b: Item = { id: 't1', user: false }
    const second = memo([u1, a1, u2, t1b])

    expect(groupIds(second)).toEqual([['u1', 'a1'], ['u2', 't1']])
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
  })

  it('handles shrinking lists without reusing stale groups', () => {
    const memo = makeMemo()
    const u1: Item = { id: 'u1', user: true }
    const a1: Item = { id: 'a1' }
    memo([u1, a1])
    const second = memo([u1])
    expect(groupIds(second)).toEqual([['u1']])
  })

  it('matches a full regroup for mixed edits', () => {
    const memo = makeMemo()
    const u1: Item = { id: 'u1', user: true }
    const a1: Item = { id: 'a1' }
    memo([u1, a1])
    const items: Item[] = [u1, a1, { id: 't1' }, { id: 'u2', user: true }, { id: 'a2' }]
    const memoized = memo(items)
    expect(groupIds(memoized)).toEqual(groupIds(groupFrom(items, 0).groups))
  })
})
