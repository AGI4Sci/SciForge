import { describe, expect, it } from 'vitest'
import {
  sanitizeRemoteWorkspaceDisplayLabel,
  sanitizeRemoteWorkspacePathLabel
} from './display'

describe('remote workspace display sanitization', () => {
  it('uses a safe fallback without leaking an opaque ID', () => {
    expect(sanitizeRemoteWorkspaceDisplayLabel('', 'Remote workspace 2'))
      .toBe('Remote workspace 2')
  })

  it('compacts whitespace and truncates labels', () => {
    expect(sanitizeRemoteWorkspaceDisplayLabel(' GPU\n\tLab ', 'Remote workspace'))
      .toBe('GPU Lab')
    expect(sanitizeRemoteWorkspaceDisplayLabel('x'.repeat(90), 'Remote workspace'))
      .toBe(`${'x'.repeat(71)}…`)
  })

  it('keeps the useful tail of long remote paths', () => {
    const path = `/shared/${'nested/'.repeat(30)}experiment/results`
    const result = sanitizeRemoteWorkspacePathLabel(path, 'Choose a folder', 48)

    expect(result.length).toBeLessThanOrEqual(48)
    expect(result.startsWith('…/')).toBe(true)
    expect(result.endsWith('experiment/results')).toBe(true)
  })
})
