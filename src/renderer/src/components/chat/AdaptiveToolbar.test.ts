import { describe, expect, it } from 'vitest'
import { fittingToolbarActions } from './AdaptiveToolbar'

describe('adaptive toolbar capacity', () => {
  it('reserves the trailing entry and gaps at the exact fit boundary', () => {
    expect(fittingToolbarActions(140, [44, 44, 44], 44, 4)).toBe(2)
    expect(fittingToolbarActions(139, [44, 44, 44], 44, 4)).toBe(1)
    expect(fittingToolbarActions(188, [44, 44, 44], 44, 4)).toBe(3)
  })

  it('uses measured widths and preserves order rather than skipping a wide action', () => {
    expect(fittingToolbarActions(150, [44, 80, 20], 44, 4)).toBe(1)
  })

  it('allows every action on wide screens and all actions in overflow on narrow ones', () => {
    expect(fittingToolbarActions(2000, [44, 44, 44], 44, 4)).toBe(3)
    expect(fittingToolbarActions(44, [44, 44, 44], 44, 4)).toBe(0)
    expect(fittingToolbarActions(2000, [], 44, 4)).toBe(0)
  })
})
