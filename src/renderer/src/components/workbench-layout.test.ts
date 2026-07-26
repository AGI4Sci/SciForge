import { describe, expect, it } from 'vitest'

import { fitWorkbenchWidths } from './workbench-layout'

describe('fitWorkbenchWidths', () => {
  it('allows the right panel to consume the remaining width', () => {
    const widths = fitWorkbenchWidths(1480, 280, 2000, {
      leftPanelVisible: true,
      rightPanelVisible: true
    })

    expect(widths.left).toBe(280)
    expect(widths.right).toBe(1186)
  })

  it('allows the right panel to use the full stage when it is the only side panel', () => {
    const widths = fitWorkbenchWidths(1280, 304, 2000, {
      leftPanelVisible: false,
      rightPanelVisible: true
    })

    expect(widths.right).toBe(1273)
  })

  it('keeps a visible right panel usable when the stored width is tiny', () => {
    const widths = fitWorkbenchWidths(1480, 280, -200, {
      leftPanelVisible: true,
      rightPanelVisible: true
    })

    expect(widths.left).toBe(280)
    expect(widths.right).toBe(300)
  })
})
