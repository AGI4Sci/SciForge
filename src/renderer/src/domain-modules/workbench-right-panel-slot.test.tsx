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
})
