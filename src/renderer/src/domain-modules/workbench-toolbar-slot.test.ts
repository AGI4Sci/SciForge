import { createElement } from 'react'
import { Newspaper } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchRightPanelContributionRegistry } from './workbench-right-panel-slot'
import {
  WORKBENCH_TOOLBAR_SLOT,
  WorkbenchToolbarActionContributionRegistry,
  type WorkbenchToolbarActionContract,
  type WorkbenchToolbarContext
} from './workbench-toolbar-slot'

const context: WorkbenchToolbarContext = {
  activeRightPanelMode: null,
  workspaceRoot: '/workspace/lab'
}

function createRegistries(): {
  panels: WorkbenchRightPanelContributionRegistry
  actions: WorkbenchToolbarActionContributionRegistry
} {
  const panels = new WorkbenchRightPanelContributionRegistry()
  const actions = new WorkbenchToolbarActionContributionRegistry(panels)
  panels.register({
    ownerId: 'sciforge.paper-radar',
    contribution: {
      id: 'paper-radar.workbench-right-panel',
      mode: 'paper',
      title: 'Paper radar',
      resourceKind: 'paper-radar',
      render: () => createElement('div')
    }
  })
  return { panels, actions }
}

function contract(overrides: Partial<WorkbenchToolbarActionContract> = {}):
WorkbenchToolbarActionContract {
  return {
    location: WORKBENCH_TOOLBAR_SLOT,
    commandId: 'paper-radar.open',
    label: 'rightPanelPaperRadar',
    target: {
      kind: 'workbench.right-panel',
      contributionId: 'paper-radar.workbench-right-panel'
    },
    ...overrides
  }
}

describe('WorkbenchToolbarActionContributionRegistry', () => {
  it('orders actions deterministically and resolves stable command IDs', () => {
    const { panels, actions } = createRegistries()
    panels.register({
      ownerId: 'sciforge.other',
      contribution: {
        id: 'other.workbench-right-panel',
        mode: 'other',
        title: 'Other',
        resourceKind: 'other',
        render: () => createElement('div')
      }
    })
    actions.register({
      id: 'other.workbench-toolbar-action',
      ownerId: 'sciforge.other',
      order: 200,
      contract: contract({
        commandId: 'other.open',
        target: {
          kind: 'workbench.right-panel',
          contributionId: 'other.workbench-right-panel'
        }
      }),
      value: { icon: Newspaper, isAvailable: () => true }
    })
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      order: 100,
      contract: contract(),
      value: { icon: Newspaper, isAvailable: () => true }
    })

    expect(actions.list().map(({ contribution }) => contribution.commandId)).toEqual([
      'paper-radar.open',
      'other.open'
    ])
    expect(actions.resolveCommand('paper-radar.open')).toMatchObject({
      ownerId: 'sciforge.paper-radar'
    })
  })

  it('rejects unknown and cross-owner panel targets', () => {
    const { panels, actions } = createRegistries()
    expect(() => actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract({
        target: {
          kind: 'workbench.right-panel',
          contributionId: 'missing.workbench-right-panel'
        }
      }),
      value: { icon: Newspaper, isAvailable: () => true }
    })).toThrow('targets unknown right-panel contribution')

    panels.register({
      ownerId: 'sciforge.other',
      contribution: {
        id: 'other.workbench-right-panel',
        mode: 'other',
        title: 'Other',
        resourceKind: 'other',
        render: () => createElement('div')
      }
    })
    expect(() => actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract({
        target: {
          kind: 'workbench.right-panel',
          contributionId: 'other.workbench-right-panel'
        }
      }),
      value: { icon: Newspaper, isAvailable: () => true }
    })).toThrow('cannot target right-panel contribution owned by')
  })

  it('rejects duplicate commands independently of contribution IDs', () => {
    const { panels, actions } = createRegistries()
    panels.register({
      ownerId: 'sciforge.paper-radar',
      contribution: {
        id: 'paper-radar.secondary-panel',
        mode: 'paper-secondary',
        title: 'Other',
        resourceKind: 'paper-radar',
        render: () => createElement('div')
      }
    })
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: { icon: Newspaper, isAvailable: () => true }
    })

    expect(() => actions.register({
      id: 'paper-radar.secondary-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract({
        target: {
          kind: 'workbench.right-panel',
          contributionId: 'paper-radar.secondary-panel'
        }
      }),
      value: { icon: Newspaper, isAvailable: () => true }
    })).toThrow('Duplicate Workbench toolbar command "paper-radar.open"')
  })

  it('executes only available actions and derives active state from the resolved target', () => {
    const { actions } = createRegistries()
    const isAvailable = vi.fn((candidate: WorkbenchToolbarContext) =>
      candidate.workspaceRoot === '/workspace/lab'
    )
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: { icon: Newspaper, isAvailable }
    })
    const toggle = vi.fn()

    expect(actions.execute('paper-radar.open', context, toggle)).toBe(true)
    expect(toggle).toHaveBeenCalledWith('paper')
    expect(actions.list()[0]!.contribution.isActive({
      ...context,
      activeRightPanelMode: 'paper'
    })).toBe(true)
    expect(isAvailable).toHaveBeenCalledWith(context)

    expect(actions.execute('paper-radar.open', {
      ...context,
      workspaceRoot: ''
    }, toggle)).toBe(false)
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('fails closed when an availability predicate throws', () => {
    const { actions } = createRegistries()
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: {
        icon: Newspaper,
        isAvailable: () => {
          throw new Error('package failure')
        }
      }
    })

    expect(actions.available(context)).toEqual([])
    expect(actions.execute('paper-radar.open', context, vi.fn())).toBe(false)
  })
})
