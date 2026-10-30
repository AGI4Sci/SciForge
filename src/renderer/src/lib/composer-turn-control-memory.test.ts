/**
 * The (runtime × model) memory used to restore the reasoning choice per scope.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composerTurnControlScopeKey,
  readComposerTurnControlMemory,
  writeComposerTurnControlMemory
} from './composer-turn-control-memory'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    }
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('composer turn-control memory', () => {
  it('round-trips a reasoning choice per runtime×model scope', () => {
    const scope = composerTurnControlScopeKey('codex', 'deepseek-v4.1-flash')
    expect(readComposerTurnControlMemory(scope)).toBeNull()
    writeComposerTurnControlMemory(scope, { reasoningEffort: 'high' })
    expect(readComposerTurnControlMemory(scope)).toEqual({ reasoningEffort: 'high' })
    // A different pair keeps its own (absent) memory.
    expect(readComposerTurnControlMemory(composerTurnControlScopeKey('claude', 'deepseek-v4.1-flash'))).toBeNull()
    expect(readComposerTurnControlMemory(composerTurnControlScopeKey('codex', 'other-model'))).toBeNull()
  })

  it('an explicit “upstream default” (empty string) is remembered as such', () => {
    const scope = composerTurnControlScopeKey('codex', 'm1')
    writeComposerTurnControlMemory(scope, { reasoningEffort: '' })
    expect(readComposerTurnControlMemory(scope)).toEqual({ reasoningEffort: '' })
  })

  it('corrupt or denied storage degrades to “no memory” instead of throwing', () => {
    const scope = composerTurnControlScopeKey('codex', 'm1')
    localStorage.setItem('sciforge.composerTurnControlMemory.v1', '{not json')
    expect(readComposerTurnControlMemory(scope)).toBeNull()
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('storage denied')
      },
      setItem: () => {
        throw new Error('storage denied')
      }
    } as Storage)
    expect(readComposerTurnControlMemory(scope)).toBeNull()
    expect(() => writeComposerTurnControlMemory(scope, { reasoningEffort: 'high' })).not.toThrow()
  })

  it('keeps memory bounded (oldest scopes are dropped first)', () => {
    for (let index = 0; index < 60; index += 1) {
      writeComposerTurnControlMemory(composerTurnControlScopeKey('codex', `m${index}`), {
        reasoningEffort: `level-${index}`
      })
    }
    expect(readComposerTurnControlMemory(composerTurnControlScopeKey('codex', 'm0'))).toBeNull()
    expect(readComposerTurnControlMemory(composerTurnControlScopeKey('codex', 'm59'))).toEqual({
      reasoningEffort: 'level-59'
    })
  })
})