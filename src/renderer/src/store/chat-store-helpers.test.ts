import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CODE_WORKSPACE_ROOTS,
  MAX_TURN_MODEL_LABELS,
  compactCodeWorkspaceRoots,
  hydrateBlockModelLabels,
  mergeComposerPickList,
  normalizeTurnModelMap,
  rememberTurnModel
} from './chat-store-helpers'

const TURN_MODEL_STORAGE_KEY = 'sciforge.turnModelLabel'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key) },
    setItem: (key, value) => { items.set(key, value) }
  }
}

describe('chat-store helpers', () => {
  beforeEach(() => vi.stubGlobal('localStorage', createMemoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('uses only the public models returned by the upstream catalog', () => {
    expect(mergeComposerPickList(false, ['sciforge-router'])).toEqual([])
    expect(mergeComposerPickList(true, [' sciforge-router ', 'sciforge-router', ''])).toEqual([
      'sciforge-router'
    ])
  })

  it('deduplicates, filters, and caps code workspace roots', () => {
    const roots = Array.from({ length: MAX_CODE_WORKSPACE_ROOTS + 4 }, (_, index) =>
      `/Users/zxy/project-${index}`
    )
    const compacted = compactCodeWorkspaceRoots([
      roots[0],
      roots[0].toUpperCase(),
      '/tmp/transient',
      '~/.sciforge/write_workspace',
      ...roots
    ])

    expect(compacted).toHaveLength(MAX_CODE_WORKSPACE_ROOTS)
    expect(compacted[0]).toBe('/Users/zxy/project-0')
    expect(compacted).not.toContain('/tmp/transient')
    expect(compacted).not.toContain('~/.sciforge/write_workspace')
  })

  it('deduplicates default workspace aliases', () => {
    expect(compactCodeWorkspaceRoots([
      '~/.sciforge/default_workspace',
      'C:\\Users\\zxy\\.sciforge\\default_workspace',
      'C:\\Users\\zxy\\.sciforge\\default_workspace\\'
    ])).toEqual(['~/.sciforge/default_workspace'])
  })

  it('normalizes and caps persisted turn model labels', () => {
    const entries = Object.fromEntries(
      Array.from({ length: MAX_TURN_MODEL_LABELS + 2 }, (_, index) => [
        `thread-${index}|turn-${index}`,
        ` model-${index} `
      ])
    )
    const normalized = normalizeTurnModelMap(entries)
    expect(Object.keys(normalized)).toHaveLength(MAX_TURN_MODEL_LABELS)
    expect(Object.values(normalized).every((label) => label === label.trim())).toBe(true)
  })

  it('persists and hydrates turn model labels', () => {
    rememberTurnModel('thread-1', 'turn-1', ' model-one ')
    expect(JSON.parse(localStorage.getItem(TURN_MODEL_STORAGE_KEY) ?? '{}')).toEqual({
      'thread-1|turn-1': 'model-one'
    })
    expect(hydrateBlockModelLabels('thread-1', [{
      kind: 'user',
      id: 'turn-1',
      text: 'hello'
    }])).toMatchObject([{ modelLabel: 'model-one' }])
  })
})
