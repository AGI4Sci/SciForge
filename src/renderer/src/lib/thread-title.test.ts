import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { getDefaultThreadTitle, getDialogThreadTitle, getDisplayThreadTitle } from './thread-title'

function thread(overrides: Partial<NormalizedThread>): NormalizedThread {
  return {
    id: 'thread-1',
    title: 'Untitled Thread',
    updatedAt: '2026-06-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    ...overrides
  }
}

describe('thread-title', () => {
  it('does not derive display titles from preview text', () => {
    expect(
      getDisplayThreadTitle(thread({
        title: 'Codex thread',
        preview: '帮我启动项目服务，然后替换 README 里的 gif'
      }))
    ).toBe(getDefaultThreadTitle())
  })

  it('uses structured titleSource to hide non-display runtime titles', () => {
    expect(
      getDisplayThreadTitle(thread({
        title: 'raw runtime setup block',
        titleSource: 'internal_prompt',
        preview: '继续修复同一个 session 生成新会话的问题'
      }))
    ).toBe(getDefaultThreadTitle())
  })

  it('keeps confirmation titles single-line and bounded', () => {
    const title = getDialogThreadTitle(thread({
      title: '这是一个很长的会话标题\n第二行还包含更多内容 '.repeat(8)
    }))

    expect(title).not.toContain('\n')
    expect(title.length).toBeLessThanOrEqual(83)
    expect(title.endsWith('...')).toBe(true)
  })
})
