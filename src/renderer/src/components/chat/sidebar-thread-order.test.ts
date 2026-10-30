import { describe, expect, it, vi } from 'vitest'
import { applySidebarThreadOrder, moveSidebarThread, readSidebarThreadOrders, SIDEBAR_THREAD_ORDER_KEY } from './sidebar-thread-order'

describe('sidebar conversation ordering', () => {
  it('moves above or below a target in both directions without losing hidden rows', () => {
    const ids = ['a', 'hidden', 'b', 'c']
    expect(moveSidebarThread(ids, 'a', 'b', true)).toEqual(['hidden', 'b', 'a', 'c'])
    expect(moveSidebarThread(ids, 'c', 'a', false)).toEqual(['c', 'a', 'hidden', 'b'])
    expect(moveSidebarThread(ids, 'a', 'a', true)).toBe(ids)
    expect(moveSidebarThread(ids, 'external', 'a', true)).toBe(ids)
  })
  it('restores manual order despite activity sorting and puts new sessions first', () => {
    expect(applySidebarThreadOrder([{ id: 'c' }, { id: 'new' }, { id: 'a' }, { id: 'b' }], ['b', 'a', 'deleted', 'c']).map((item) => item.id))
      .toEqual(['new', 'b', 'a', 'c'])
  })
  it('reads saved groups and ignores malformed entries or unavailable storage', () => {
    const getItem = vi.fn(() => JSON.stringify({ workspace: ['b', 'a'], invalid: [42] }))
    vi.stubGlobal('localStorage', { getItem })
    try {
      expect(readSidebarThreadOrders()).toEqual({ workspace: ['b', 'a'] })
      expect(getItem).toHaveBeenCalledWith(SIDEBAR_THREAD_ORDER_KEY)
      getItem.mockReturnValue('bad json')
      expect(readSidebarThreadOrders()).toEqual({})
      getItem.mockImplementation(() => { throw new Error('Unavailable') })
      expect(readSidebarThreadOrders()).toEqual({})
    } finally { vi.unstubAllGlobals() }
  })
})
