import { createElement } from 'react'
import { Newspaper } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import {
  WorkbenchRightPanelContributionRegistry,
  type WorkbenchRightPanelContribution
} from './workbench-right-panel-slot'

function contribution(mode: WorkbenchRightPanelContribution['mode']): WorkbenchRightPanelContribution {
  return {
    id: `example.${mode}.workbench-right-panel`,
    mode,
    label: 'rightPanelPaperRadar',
    icon: Newspaper,
    title: 'Example panel',
    resourceKind: `example-${mode}`,
    isAvailable: () => true,
    render: () => createElement('div')
  }
}

describe('WorkbenchRightPanelContributionRegistry', () => {
  it('resolves a namespaced contribution ID by its existing panel mode', () => {
    const registry = new WorkbenchRightPanelContributionRegistry()
    registry.register({
      ownerId: 'sciforge.paper-radar',
      contribution: {
        ...contribution('paper'),
        id: 'sciforge.paper-radar.workbench-right-panel'
      }
    })

    expect(registry.resolve('paper')).toMatchObject({
      id: 'sciforge.paper-radar.workbench-right-panel',
      ownerId: 'sciforge.paper-radar'
    })
  })

  it('rejects two contributions that claim the same panel mode', () => {
    const registry = new WorkbenchRightPanelContributionRegistry()
    registry.register({
      ownerId: 'sciforge.paper-radar',
      contribution: {
        ...contribution('paper'),
        id: 'sciforge.paper-radar.workbench-right-panel'
      }
    })

    expect(() => registry.register({
      ownerId: 'example.other',
      contribution: {
        ...contribution('paper'),
        id: 'example.other.workbench-right-panel'
      }
    })).toThrow('Duplicate Workbench right-panel mode "paper"')
  })

  it('passes the owning workspace root through the generic render contract', () => {
    let renderedWorkspaceRoot: string | undefined
    const registry = new WorkbenchRightPanelContributionRegistry()
    const panel = {
      ...contribution('paper'),
      render: ({ workspaceRoot }: Parameters<WorkbenchRightPanelContribution['render']>[0]) => {
        renderedWorkspaceRoot = workspaceRoot
        return createElement('div')
      }
    }
    registry.register({ ownerId: 'example.panel', contribution: panel })

    registry.resolve('paper')?.contribution.render({
      className: 'h-full',
      onCollapse: () => undefined,
      workspaceRoot: '/workspace/owner'
    })

    expect(renderedWorkspaceRoot).toBe('/workspace/owner')
  })
})
