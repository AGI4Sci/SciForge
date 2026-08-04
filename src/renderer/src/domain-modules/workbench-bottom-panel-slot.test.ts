import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchBottomPanelContributionRegistry
} from './workbench-bottom-panel-slot'

describe('WorkbenchBottomPanelContributionRegistry', () => {
  it('registers owner-aware bottom panels and rejects duplicate IDs', () => {
    const registry = new WorkbenchBottomPanelContributionRegistry()
    const render = vi.fn(() => null as never)
    registry.register({
      id: 'fixture.bottom-panel',
      ownerId: 'fixture.module',
      order: 20,
      contract: {
        location: 'workbench.bottom-panel',
        title: 'Fixture panel',
        resourceKind: 'fixture-process'
      },
      value: { render }
    })

    expect(registry.resolve('fixture.bottom-panel')).toMatchObject({
      id: 'fixture.bottom-panel',
      ownerId: 'fixture.module',
      contribution: {
        title: 'Fixture panel',
        resourceKind: 'fixture-process'
      }
    })
    expect(() => registry.register({
      id: 'fixture.bottom-panel',
      ownerId: 'other.module',
      contract: {
        location: 'workbench.bottom-panel',
        title: 'Duplicate'
      },
      value: { render }
    })).toThrow('Duplicate renderer contribution "fixture.bottom-panel"')
  })

  it('disposes all registered panels idempotently', () => {
    const registry = new WorkbenchBottomPanelContributionRegistry()
    registry.register({
      id: 'fixture.bottom-panel',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.bottom-panel',
        title: 'Fixture panel'
      },
      value: { render: () => null as never }
    })

    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
