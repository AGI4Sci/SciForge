import { describe, expect, it } from 'vitest'
import { fitPageDockSizes, fitPageFloatingBounds, pageDockDropTarget, restorePageDockState } from './workbench-page-layout'
import { WorkbenchMainAreaContributionRegistry } from '../domain-modules/workbench-main-area'

const registry = new WorkbenchMainAreaContributionRegistry()
for (const [id, defaultPosition] of [['fixture.notes', 'right'], ['fixture.team', 'main']] as const) {
  registry.register({ id, ownerId: 'fixture',
    contract: { location: 'workbench.main-area', contractVersion: '1.0.0', label: id,
      preferredHostSidebar: 'expanded', docking: { defaultPosition, preferredWidth: 520 } },
    value: { render: () => null } })
}

describe('page docking preferences', () => {
  it('restores floating and external placement with bounded geometry and return locations', () => {
    const state = restorePageDockState(registry.list(), JSON.stringify({
      pages: { 'fixture.notes': { position: 'window', open: true }, 'fixture.team': { position: 'floating', open: true } },
      floating: { 'fixture.team': { x: -5000, y: 99999, width: 5000, height: 700 } },
      windows: { 'fixture.notes': { x: -1200, y: 20, width: 720, height: 600 } },
      docked: { 'fixture.notes': 'bottom', 'fixture.team': 'corrupt' }
    }))
    expect(state.pages['fixture.notes'].position).toBe('window')
    expect(state.pages['fixture.team'].position).toBe('floating')
    expect(state.docked).toEqual({ 'fixture.notes': 'bottom', 'fixture.team': 'main' })
    expect(state.windows['fixture.notes'].x).toBe(-1200)
    expect(fitPageFloatingBounds(state.floating['fixture.team'], 900, 600)).toEqual({ x: 0, y: 0, width: 900, height: 600 })
    expect(fitPageFloatingBounds({ x: 800, y: 800, width: 600, height: 400 }, 300, 150)).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })

  it('recognizes edge and central docking targets while leaving free space for floating', () => {
    expect(pageDockDropTarget(10, 200, 1000, 800)).toBe('left')
    expect(pageDockDropTarget(990, 200, 1000, 800)).toBe('right')
    expect(pageDockDropTarget(500, 790, 1000, 800)).toBe('bottom')
    expect(pageDockDropTarget(500, 10, 1000, 800)).toBe('main')
    expect(pageDockDropTarget(500, 400, 1000, 800)).toBe('main')
    expect(pageDockDropTarget(448, 400, 1000, 800)).toBe('left')
    expect(pageDockDropTarget(552, 400, 1000, 800)).toBe('right')
    expect(pageDockDropTarget(500, 452, 1000, 800)).toBe('bottom')
    expect(pageDockDropTarget(250, 200, 1000, 800)).toBeNull()
    expect(pageDockDropTarget(-20, 200, 1000, 800)).toBeNull()
  })
  it('uses package defaults and only opens a page on request', () => {
    const state = restorePageDockState(registry.list(), null)
    expect(state.pages).toEqual({ 'fixture.notes': { position: 'right', open: false }, 'fixture.team': { position: 'main', open: false } })
    expect(state.sizes.right).toBe(520)
  })

  it('restores only installed contributions and validates corrupt preferences', () => {
    for (const raw of ['not JSON', 'null', '[]', '4', '{}']) {
      expect(restorePageDockState(registry.list(), raw).pages['fixture.notes'].position).toBe('right')
    }
    const state = restorePageDockState(registry.list(), JSON.stringify({
      pages: { 'fixture.notes': { position: 'bottom', open: true }, 'fixture.team': { position: 'float', open: 1 }, removed: { position: 'left', open: true } },
      selected: { bottom: 'fixture.notes', left: 'removed' }, sizes: { left: -100, right: '500', bottom: 50000 }
    }))
    expect(Object.keys(state.pages)).toEqual(['fixture.notes', 'fixture.team'])
    expect(state.pages['fixture.team']).toEqual({ position: 'main', open: false })
    expect(state.selected).toEqual({ bottom: 'fixture.notes' })
    expect(state.sizes).toEqual({ left: 280, right: 520, bottom: 900 })
  })

  it('keeps the center reachable and fits both sides and bottom without changing saved dimensions', () => {
    const saved = { left: 520, right: 520, bottom: 600 }
    const fitted = fitPageDockSizes(saved, { left: true, right: true, bottom: true }, 900, 700)
    expect(fitted).toEqual({ left: 284, right: 284, bottom: 454 })
    expect(saved).toEqual({ left: 520, right: 520, bottom: 600 })
    expect(fitPageDockSizes(saved, { left: false, right: false, bottom: false }, 900, 700)).toEqual({ left: 0, right: 0, bottom: 0 })
    const narrow = fitPageDockSizes(saved, { left: true, right: true, bottom: true }, 300, 300)
    expect(narrow.left + narrow.right + 12).toBeLessThan(300)
    expect(narrow.bottom).toBeLessThan(300)
  })
})
