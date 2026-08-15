import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  ResourceNavigationContributionRegistry,
  resolveResourceNavigation
} from './resource-navigation-registry'
import { WorkbenchRightPanelContributionRegistry } from './workbench-right-panel-slot'

function registerPanel(
  panels: WorkbenchRightPanelContributionRegistry,
  id: string,
  ownerId: string
): void {
  panels.register({
    id,
    ownerId,
    contract: { location: 'workbench.right-panel', title: id },
    value: { render: () => createElement('div') }
  })
}

describe('ResourceNavigationContributionRegistry', () => {
  it('resolves an exact resource only through its unique declared owner', () => {
    const panels = new WorkbenchRightPanelContributionRegistry()
    registerPanel(panels, 'fixture.first-panel', 'fixture.first-owner')
    registerPanel(panels, 'fixture.duplicate-panel', 'fixture.duplicate-owner')
    const registry = new ResourceNavigationContributionRegistry(panels)
    const resolve = () => null
    registry.register({
      id: 'fixture.first',
      ownerId: 'fixture.first-owner',
      order: 10,
      contract: {
        resourceKinds: ['artifact-version', 'compute-run'],
        target: { surface: 'right-panel', contributionId: 'fixture.first-panel' }
      },
      value: { resolve }
    })

    expect(registry.resolve(' artifact-version ')?.id).toBe('fixture.first')
    expect(registry.resolve('compute-run')?.id).toBe('fixture.first')
    expect(registry.resolve('unknown')).toBeNull()
    expect(() => registry.register({
      id: 'fixture.duplicate',
      ownerId: 'fixture.duplicate-owner',
      order: 20,
      contract: {
        resourceKinds: ['artifact-version'],
        target: { surface: 'right-panel', contributionId: 'fixture.duplicate-panel' }
      },
      value: { resolve }
    })).toThrow('Duplicate resource navigation owner for "artifact-version"')
  })

  it('disposes registered navigators idempotently', () => {
    const panels = new WorkbenchRightPanelContributionRegistry()
    registerPanel(panels, 'fixture.panel', 'fixture.owner')
    const registry = new ResourceNavigationContributionRegistry(panels)
    registry.register({
      id: 'fixture.navigator',
      ownerId: 'fixture.owner',
      contract: {
        resourceKinds: ['artifact-version'],
        target: { surface: 'right-panel', contributionId: 'fixture.panel' }
      },
      value: { resolve: () => null }
    })
    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })

  it('creates one validated right-panel input without exposing owner activation to callers', () => {
    const panels = new WorkbenchRightPanelContributionRegistry()
    registerPanel(panels, 'fixture.panel', 'fixture.owner')
    const registry = new ResourceNavigationContributionRegistry(panels)
    registry.register({
      id: 'fixture.navigator',
      ownerId: 'fixture.owner',
      contract: {
        resourceKinds: ['artifact-version'],
        target: { surface: 'right-panel', contributionId: 'fixture.panel' }
      },
      value: {
        resolve: ({ resource }) => ({
          activation: {
            revision: 1,
            payload: { exactId: resource.resourceId }
          }
        })
      }
    })

    expect(resolveResourceNavigation(registry, {
      sessionId: ' session-1 ',
      resource: {
        resourceKind: ' artifact-version ',
        resourceId: ' artifact-version:figure:2 '
      }
    })).toEqual({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation: {
        contributionId: 'fixture.panel',
        revision: 1,
        payload: { exactId: 'artifact-version:figure:2' }
      }
    })
    expect(resolveResourceNavigation(registry, {
      sessionId: 'session-1',
      resource: { resourceKind: 'unknown', resourceId: 'unknown:1' }
    })).toBeNull()
  })

  it('rejects missing and cross-owner target panels', () => {
    const missingPanels = new WorkbenchRightPanelContributionRegistry()
    const missingRegistry = new ResourceNavigationContributionRegistry(missingPanels)
    expect(() => missingRegistry.register({
      id: 'fixture.navigator',
      ownerId: 'fixture.owner',
      contract: {
        resourceKinds: ['artifact-version'],
        target: { surface: 'right-panel', contributionId: 'fixture.missing-panel' }
      },
      value: { resolve: () => null }
    })).toThrow('targets missing right panel "fixture.missing-panel"')

    const foreignPanels = new WorkbenchRightPanelContributionRegistry()
    registerPanel(foreignPanels, 'fixture.foreign-panel', 'fixture.foreign-owner')
    const foreignRegistry = new ResourceNavigationContributionRegistry(foreignPanels)
    expect(() => foreignRegistry.register({
      id: 'fixture.navigator',
      ownerId: 'fixture.owner',
      contract: {
        resourceKinds: ['artifact-version'],
        target: { surface: 'right-panel', contributionId: 'fixture.foreign-panel' }
      },
      value: { resolve: () => null }
    })).toThrow('cannot target right panel fixture.foreign-owner/fixture.foreign-panel')
  })
})
