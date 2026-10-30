import { Newspaper } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { WorkbenchCommandRegistry } from './workbench-command-registry'
import {
  WORKBENCH_TOOLBAR_SLOT,
  WorkbenchToolbarActionContributionRegistry,
  type WorkbenchToolbarActionContract
} from './workbench-toolbar-slot'

function createRegistries(): {
  commands: WorkbenchCommandRegistry
  actions: WorkbenchToolbarActionContributionRegistry
} {
  const commands = new WorkbenchCommandRegistry()
  const actions = new WorkbenchToolbarActionContributionRegistry(commands)
  commands.register({
    id: 'paper-radar.open',
    ownerId: 'sciforge.paper-radar',
    contribution: {
      execute: () => undefined,
      isAvailable: ({ workspaceRoot }) => workspaceRoot === '/workspace/lab',
      isActive: ({ activeSurface }) =>
        activeSurface?.kind === 'right-panel' &&
        activeSurface.contributionId === 'paper-radar.workbench-right-panel'
    }
  })
  return { commands, actions }
}

function contract(
  overrides: Partial<WorkbenchToolbarActionContract> = {}
): WorkbenchToolbarActionContract {
  return {
    location: WORKBENCH_TOOLBAR_SLOT,
    commandId: 'paper-radar.open',
    label: 'rightPanelPaperRadar',
    ...overrides
  }
}

describe('WorkbenchToolbarActionContributionRegistry', () => {
  it('orders toolbar presentation deterministically and resolves stable command IDs', () => {
    const { commands, actions } = createRegistries()
    commands.register({
      id: 'other.open',
      ownerId: 'sciforge.other',
      contribution: { execute: () => undefined }
    })
    actions.register({
      id: 'other.workbench-toolbar-action',
      ownerId: 'sciforge.other',
      order: 200,
      contract: contract({ commandId: 'other.open' }),
      value: { icon: Newspaper }
    })
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      order: 100,
      contract: contract(),
      value: { icon: Newspaper }
    })

    expect(actions.list().map(({ contribution }) => contribution.commandId)).toEqual([
      'paper-radar.open',
      'other.open'
    ])
    expect(actions.resolveCommand('paper-radar.open')).toMatchObject({
      ownerId: 'sciforge.paper-radar'
    })
  })

  it('rejects unknown and cross-owner command references', () => {
    const { commands, actions } = createRegistries()
    expect(() => actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract({ commandId: 'missing.open' }),
      value: { icon: Newspaper }
    })).toThrow('references unknown command "missing.open"')

    commands.register({
      id: 'other.open',
      ownerId: 'sciforge.other',
      contribution: { execute: () => undefined }
    })
    expect(() => actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract({ commandId: 'other.open' }),
      value: { icon: Newspaper }
    })).toThrow('cannot reference command owned by "sciforge.other"')
  })

  it('rejects duplicate toolbar placements for one command', () => {
    const { actions } = createRegistries()
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: { icon: Newspaper }
    })

    expect(() => actions.register({
      id: 'paper-radar.secondary-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: { icon: Newspaper }
    })).toThrow('Duplicate Workbench toolbar command "paper-radar.open"')
  })

  it('delegates availability and active state to the referenced command', () => {
    const { actions } = createRegistries()
    actions.register({
      id: 'paper-radar.workbench-toolbar-action',
      ownerId: 'sciforge.paper-radar',
      contract: contract(),
      value: { icon: Newspaper }
    })

    expect(actions.available({ workspaceRoot: '' })).toEqual([])
    expect(actions.available({ workspaceRoot: '/workspace/lab' })).toHaveLength(1)
    expect(actions.list()[0]!.contribution.isActive({
      activeSurface: {
        kind: 'right-panel',
        contributionId: 'paper-radar.workbench-right-panel'
      }
    })).toBe(true)
  })
})
