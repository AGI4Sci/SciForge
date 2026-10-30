import { describe, expect, it } from 'vitest'
import {
  buildWriteTemplateShortcutExpansion,
  formatWriteTemplateDate
} from './template-shortcuts'

describe('write template shortcuts', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(formatWriteTemplateDate(new Date(2026, 5, 8))).toBe('2026-06-08')
  })

  it('expands @date at the cursor', () => {
    expect(
      buildWriteTemplateShortcutExpansion({
        text: 'Published: @date',
        cursor: 'Published: @date'.length,
        now: new Date(2026, 5, 8)
      })
    ).toEqual({
      from: 'Published: '.length,
      to: 'Published: @date'.length,
      insert: '2026-06-08'
    })
  })

  it('does not expand inside words or email-like text', () => {
    expect(
      buildWriteTemplateShortcutExpansion({
        text: 'name@date',
        cursor: 'name@date'.length,
        now: new Date(2026, 5, 8)
      })
    ).toBeNull()
  })

  it('ignores unknown shortcuts', () => {
    expect(
      buildWriteTemplateShortcutExpansion({
        text: '@datetime',
        cursor: '@datetime'.length,
        now: new Date(2026, 5, 8)
      })
    ).toBeNull()
  })
})
