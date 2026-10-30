import { describe, expect, it } from 'vitest'
import {
  clampContentScale,
  resolveContentZoomWheel,
  stepContentScale
} from './content-zoom-shortcuts'

function wheelEvent(input: Partial<Pick<WheelEvent, 'ctrlKey' | 'deltaY'>>) {
  return {
    ctrlKey: false,
    deltaY: 0,
    ...input
  }
}

describe('content zoom shortcuts', () => {
  it('recognizes Ctrl-wheel zoom direction', () => {
    expect(resolveContentZoomWheel(wheelEvent({ ctrlKey: true, deltaY: -100 }))).toBe('in')
    expect(resolveContentZoomWheel(wheelEvent({ ctrlKey: true, deltaY: 100 }))).toBe('out')
  })

  it('ignores ordinary wheel scrolling', () => {
    expect(resolveContentZoomWheel(wheelEvent({ deltaY: -100 }))).toBeNull()
    expect(resolveContentZoomWheel(wheelEvent({ ctrlKey: true, deltaY: 0 }))).toBeNull()
  })

  it('steps and clamps content scales', () => {
    expect(stepContentScale(1, 1, { min: 0.65, max: 2.4, step: 0.1 })).toBe(1.1)
    expect(stepContentScale(2.39, 1, { min: 0.65, max: 2.4, step: 0.1 })).toBe(2.4)
    expect(stepContentScale(0.66, -1, { min: 0.65, max: 2.4, step: 0.1 })).toBe(0.65)
    expect(clampContentScale(Number.NaN, 0.65, 2.4)).toBe(0.65)
  })
})
