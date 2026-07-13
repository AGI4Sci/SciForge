import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../../lib/browser-storage'
import {
  COMPOSER_INPUT_MEMORY_STORAGE_KEY,
  composerDraftContextKey,
  mergeComposerInputHistory,
  navigateComposerHistory,
  readComposerDraft,
  readComposerInputHistory,
  rememberComposerInput,
  writeComposerDraft
} from './composer-input-memory'

function memoryStorage(): BrowserStorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

describe('composer input memory', () => {
  it('stores independent drafts for threads and restores exact whitespace', () => {
    const storage = memoryStorage()
    const first = composerDraftContextKey({ threadId: 'thread-1', workspaceRoot: '/tmp/a' })
    const second = composerDraftContextKey({ threadId: 'thread-2', workspaceRoot: '/tmp/a' })

    writeComposerDraft(first, '  continue this analysis\nwith context  ', storage, 1)
    writeComposerDraft(second, 'another draft', storage, 2)

    expect(readComposerDraft(first, storage)).toBe('  continue this analysis\nwith context  ')
    expect(readComposerDraft(second, storage)).toBe('another draft')
    expect(composerDraftContextKey({ workspaceRoot: '/tmp/a' })).toBe('workspace:/tmp/a')
  })

  it('removes cleared drafts and fails open for malformed persisted data', () => {
    const storage = memoryStorage()
    writeComposerDraft('thread:one', 'temporary', storage)
    writeComposerDraft('thread:one', '', storage)
    expect(readComposerDraft('thread:one', storage)).toBe('')

    storage.setItem(COMPOSER_INPUT_MEMORY_STORAGE_KEY, '{broken json')
    expect(readComposerDraft('thread:one', storage)).toBe('')
    expect(readComposerInputHistory(storage)).toEqual([])
  })

  it('keeps recent unique sent inputs in chronological order', () => {
    const storage = memoryStorage()
    rememberComposerInput(' first prompt ', storage)
    rememberComposerInput('second prompt', storage)
    rememberComposerInput('first prompt', storage)

    expect(readComposerInputHistory(storage)).toEqual(['second prompt', 'first prompt'])
  })

  it('uses persisted send order ahead of older active-thread fallback messages', () => {
    const history = mergeComposerInputHistory(
      ['old thread prompt', 'duplicated prompt', 'latest message in an old thread snapshot'],
      ['duplicated prompt', 'actual most recent prompt']
    )

    expect(history).toEqual([
      'old thread prompt',
      'latest message in an old thread snapshot',
      'duplicated prompt',
      'actual most recent prompt'
    ])
    expect(navigateComposerHistory({
      key: 'ArrowUp',
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      history,
      state: { cursor: null, draft: '' }
    })?.value).toBe('actual most recent prompt')
  })

  it('navigates backward, forward, and back to the unsent draft', () => {
    const history = ['first', 'second', 'third']
    const up = navigateComposerHistory({
      key: 'ArrowUp',
      value: 'work in progress',
      selectionStart: 0,
      selectionEnd: 0,
      history,
      state: { cursor: null, draft: 'work in progress' }
    })
    expect(up).toEqual({ cursor: 2, draft: 'work in progress', value: 'third' })

    const older = navigateComposerHistory({
      key: 'ArrowUp',
      value: up!.value,
      selectionStart: up!.value.length,
      selectionEnd: up!.value.length,
      history,
      state: up!
    })
    expect(older?.value).toBe('second')

    const newer = navigateComposerHistory({
      key: 'ArrowDown',
      value: older!.value,
      selectionStart: older!.value.length,
      selectionEnd: older!.value.length,
      history,
      state: older!
    })
    expect(newer?.value).toBe('third')

    const restored = navigateComposerHistory({
      key: 'ArrowDown',
      value: newer!.value,
      selectionStart: newer!.value.length,
      selectionEnd: newer!.value.length,
      history,
      state: newer!
    })
    expect(restored).toEqual({ cursor: null, draft: 'work in progress', value: 'work in progress' })
  })

  it('preserves normal multiline cursor navigation until history mode starts', () => {
    expect(navigateComposerHistory({
      key: 'ArrowUp',
      value: 'first line\nsecond line',
      selectionStart: 18,
      selectionEnd: 18,
      history: ['previous'],
      state: { cursor: null, draft: 'first line\nsecond line' }
    })).toBeNull()
    expect(navigateComposerHistory({
      key: 'ArrowDown',
      value: 'first line\nsecond line',
      selectionStart: 2,
      selectionEnd: 2,
      history: ['previous'],
      state: { cursor: null, draft: 'first line\nsecond line' }
    })).toBeNull()
  })
})
