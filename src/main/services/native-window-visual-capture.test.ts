import { describe, expect, it, vi } from 'vitest'
import { collectNativeCaptureLayers } from './native-window-visual-capture'

describe('native window visual capture composition', () => {
  it('collects visible web contents descendants with parent clipping and stacking order', () => {
    const first = { isDestroyed: () => false } as never
    const second = { isDestroyed: () => false } as never
    const hidden = { getVisible: () => false, children: [], getBounds: () => ({ x: 0, y: 0, width: 5, height: 5 }) } as never
    const root = {
      children: [
        { getVisible: () => true, getBounds: () => ({ x: 10, y: 20, width: 100, height: 80 }), webContents: first, children: [] },
        { getVisible: () => true, getBounds: () => ({ x: 50, y: 50, width: 100, height: 80 }), webContents: second, children: [hidden] }
      ]
    } as never
    const layers = collectNativeCaptureLayers(root, { x: 0, y: 0, width: 120, height: 100 })
    expect(layers).toHaveLength(2)
    expect(layers[0].bounds).toEqual({ x: 10, y: 20, width: 100, height: 80 })
    expect(layers[1].clip).toEqual({ x: 50, y: 50, width: 70, height: 50 })
  })
})
