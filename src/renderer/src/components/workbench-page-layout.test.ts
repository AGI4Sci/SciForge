import { describe, expect, it } from 'vitest'
import { fitPageDockSizes, restorePageDockState } from './workbench-page-layout'
import { WorkbenchMainAreaContributionRegistry } from '../domain-modules/workbench-main-area'

const registry = new WorkbenchMainAreaContributionRegistry()
for (const [id, defaultPosition] of [['fixture.notes', 'right'], ['fixture.team', 'main']] as const) {
  registry.register({ id, ownerId: 'fixture',
    contract: { location: 'workbench.main-area', contractVersion: '1.0.0', label: id,
      preferredHostSidebar: 'expanded', docking: { defaultPosition, preferredWidth: 520 } },
    value: { render: () => null } })
}

describe('page docking preferences', () => {
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
