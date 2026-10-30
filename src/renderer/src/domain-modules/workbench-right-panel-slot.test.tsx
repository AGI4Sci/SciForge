import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchRightPanelContributionRegistry
} from './workbench-right-panel-slot'

describe('WorkbenchRightPanelContributionRegistry', () => {
  it('registers and resolves owner-aware panels only by contribution ID', () => {
    const registry = new WorkbenchRightPanelContributionRegistry()
    const render = vi.fn(() => createElement('div'))
    registry.register({
      id: 'fixture.right-panel',
      ownerId: 'fixture.module',
      order: 20,
      contract: {
        location: 'workbench.right-panel',
        title: 'Fixture panel',
        resourceKind: 'fixture-resource'
      },
      value: { render }
    })

    expect(registry.resolve('fixture.right-panel')).toMatchObject({
      id: 'fixture.right-panel',
      ownerId: 'fixture.module',
      contribution: {
        id: 'fixture.right-panel',
        location: 'workbench.right-panel',
        title: 'Fixture panel',
        resourceKind: 'fixture-resource'
      }
    })
    expect(registry.resolve('paper')).toBeNull()
    expect(registry.resolve(null)).toBeNull()
  })

  it('rejects duplicate contribution IDs without host-reserved modes', () => {
    const registry = new WorkbenchRightPanelContributionRegistry()
    const input = {
      id: 'fixture.right-panel',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.right-panel' as const,
        title: 'Fixture panel'
      },
      value: { render: () => createElement('div') }
    }
    registry.register(input)

    expect(() => registry.register({
      ...input,
      ownerId: 'other.module'
    })).toThrow('Duplicate renderer contribution "fixture.right-panel"')
  })

  it('passes session and activation data through the SDK render contract', () => {
    const render = vi.fn(() => createElement('div'))
    const registry = new WorkbenchRightPanelContributionRegistry()
    registry.register({
      id: 'fixture.right-panel',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.right-panel',
        title: 'Fixture panel'
      },
      value: { render }
    })

    const context = {
      active: true,
      focused: true,
      surfaceId: 'right-panel-pane:fixture',
      className: 'h-full',
      onCollapse: () => undefined,
      session: {
        id: 'session-owner',
        runtimeId: 'codex',
        workspaceRoot: '/workspace/owner'
      },
      activation: {
        revision: 2,
        payload: { nodeId: 'node-2' }
      }
    }
    registry.resolve('fixture.right-panel')?.contribution.render(context)

    expect(render).toHaveBeenCalledWith(context)
  })

  it('disposes all registered panels idempotently', () => {
    const registry = new WorkbenchRightPanelContributionRegistry()
    registry.register({
      id: 'fixture.right-panel',
      ownerId: 'fixture.module',
      contract: {
        location: 'workbench.right-panel',
        title: 'Fixture panel'
      },
      value: { render: () => createElement('div') }
    })

    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
