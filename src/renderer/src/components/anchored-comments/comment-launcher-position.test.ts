import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMENT_LAUNCHER_POSITION_STORAGE_KEY,
  clampCommentLauncherPosition,
  readCommentLauncherPosition,
  writeCommentLauncherPosition
} from './comment-launcher-position'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  })
})

describe('comment launcher position', () => {
  it('keeps the launcher inside the viewport margin', () => {
    expect(
      clampCommentLauncherPosition(
        { x: 900, y: -20 },
        { width: 100, height: 44 },
        { width: 800, height: 600 }
      )
    ).toEqual({ x: 688, y: 12 })
  })

  it('keeps the launcher visible in a viewport smaller than the launcher', () => {
    expect(
      clampCommentLauncherPosition(
        { x: 50, y: 50 },
        { width: 120, height: 80 },
        { width: 100, height: 60 }
      )
    ).toEqual({ x: 0, y: 0 })
  })

  it('persists and restores a valid position', () => {
    expect(writeCommentLauncherPosition({ x: 120, y: 240 })).toBe(true)
    expect(readCommentLauncherPosition()).toEqual({ x: 120, y: 240 })
  })

  it('ignores malformed persisted values', () => {
    storage.set(COMMENT_LAUNCHER_POSITION_STORAGE_KEY, '{"x":"left","y":10}')
    expect(readCommentLauncherPosition()).toBeNull()
  })
})
