import { expect, it } from 'vitest'
import { clampPanelGeometry } from './floating-panel-geometry'
it('keeps entire dragged or resized panel within viewport, including tiny viewports', () => {
  expect(clampPanelGeometry({ x: -20, y: 790, width: 440, height: 540 }, { width: 1000, height: 800 })).toEqual({ x: 0, y: 260, width: 440, height: 540 })
  expect(clampPanelGeometry({ x: 900, y: 700, width: 2000, height: 900 }, { width: 240, height: 180 })).toEqual({ x: 0, y: 0, width: 240, height: 180 })
  expect(clampPanelGeometry({ x: 10, y: 20, width: 1, height: 1 }, { width: 1000, height: 800 })).toEqual({ x: 10, y: 20, width: 300, height: 260 })
})
