import { describe, expect, it } from 'vitest'

import {
  WORKBENCH_MAIN_SURFACE_MIN_WIDTH,
  fitWorkbenchWidths,
  rightPanelPaneWidthFromPointerDelta
} from './workbench-layout'

describe('fitWorkbenchWidths', () => {
  it('caps the dock viewport while retaining the main-surface minimum', () => {
    const widths = fitWorkbenchWidths(1480, 280, [2000], {
      leftPanelVisible: true
    })

    expect(widths).toEqual({
      left: 280,
      rightDockViewport: 833,
      rightDockContent: 2007
    })
    expect(1480 - 7 - widths.left - widths.rightDockViewport).toBe(
      WORKBENCH_MAIN_SURFACE_MIN_WIDTH
    )
  })

  it('caps a lone dock after reserving the main surface', () => {
    const widths = fitWorkbenchWidths(1280, 304, [2000], {
      leftPanelVisible: false
    })

    expect(widths.rightDockViewport).toBe(920)
    expect(widths.rightDockContent).toBe(2007)
  })

  it('keeps each pane at its hard minimum without inflating the dock viewport', () => {
    const widths = fitWorkbenchWidths(1480, 280, [-200, 120], {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(614)
    expect(widths.rightDockViewport).toBe(614)
  })

  it('uses dock-local overflow when preferred pane widths exceed the viewport', () => {
    const paneWidths = [320, 480, 360, 640]
    const widths = fitWorkbenchWidths(1480, 280, paneWidths, {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(1828)
    expect(widths.rightDockViewport).toBe(833)
    expect(widths.rightDockContent).toBeGreaterThan(widths.rightDockViewport)
    expect(paneWidths).toEqual([320, 480, 360, 640])
  })

  it('shrinks side viewports responsively before consuming the main minimum', () => {
    const wide = fitWorkbenchWidths(1400, 304, [720], {
      leftPanelVisible: true
    })
    const narrow = fitWorkbenchWidths(820, 304, [720], {
      leftPanelVisible: true
    })

    expect(wide).toMatchObject({ left: 304, rightDockViewport: 727 })
    expect(narrow).toMatchObject({ left: 273, rightDockViewport: 180 })
    expect(820 - 7 - narrow.left - narrow.rightDockViewport).toBe(
      WORKBENCH_MAIN_SURFACE_MIN_WIDTH
    )
    expect(narrow.rightDockContent).toBe(727)
  })

  it('does not impose a pane-count limit', () => {
    const paneWidths = Array.from({ length: 128 }, () => 300)
    const widths = fitWorkbenchWidths(1480, 280, paneWidths, {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(39_296)
    expect(widths.rightDockViewport).toBe(833)
  })
})

describe('rightPanelPaneWidthFromPointerDelta', () => {
  it('derives the adjacent pane width from either separator edge and enforces its minimum', () => {
    expect(rightPanelPaneWidthFromPointerDelta(420, -80, 'start')).toBe(500)
    expect(rightPanelPaneWidthFromPointerDelta(420, 80, 'end')).toBe(500)
    expect(rightPanelPaneWidthFromPointerDelta(320, 80, 'start')).toBe(300)
  })
})
