import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchGlobalOverlayContributionRegistry
} from './workbench-global-overlay-slot'

describe('WorkbenchGlobalOverlayContributionRegistry', () => {
  it('registers, resolves, renders, and disposes owner-aware overlays', () => {
    const render = vi.fn(() => null as never)
    const registry = new WorkbenchGlobalOverlayContributionRegistry()
    registry.register({
      id: 'fixture.overlay',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.global-overlay',
        title: 'Fixture overlay'
      },
      value: { render }
    })

    const overlay = registry.resolve('fixture.overlay')
    expect(overlay).toMatchObject({
      id: 'fixture.overlay',
      ownerId: 'fixture.module',
      contribution: {
        location: 'workbench.global-overlay',
        title: 'Fixture overlay'
      }
    })
    const context = {
      active: true,
      className: 'fixed inset-0',
      onClose: () => undefined,
      session: { id: 'session-1' }
    }
    overlay?.contribution.render(context)
    expect(render).toHaveBeenCalledWith(context)

    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })

  it('rejects duplicate overlay contribution IDs', () => {
    const registry = new WorkbenchGlobalOverlayContributionRegistry()
    const contribution = {
      id: 'fixture.overlay',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.global-overlay' as const,
        title: 'Fixture overlay'
      },
      value: { render: () => null as never }
    }
    registry.register(contribution)
    expect(() => registry.register({
      ...contribution,
      ownerId: 'other.module'
    })).toThrow('Duplicate renderer contribution "fixture.overlay"')
  })
})
