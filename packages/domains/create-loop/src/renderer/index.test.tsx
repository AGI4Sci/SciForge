import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createCreateLoopCommandContribution,
  createDomainRendererEntry
} from './index.js'

test('command opens the package-owned panel through the public Workbench host', () => {
  const opened: unknown[] = []
  const host = rendererHost(opened)
  const command = createCreateLoopCommandContribution(host)

  assert.equal(command.isAvailable?.({
    sessionId: 'thread-1',
    workspaceRoot: '/workspace'
  }), true)
  assert.equal(command.isAvailable?.({ sessionId: 'thread-1' }), false)
  command.execute({
    sessionId: 'thread-1',
    workspaceRoot: '/workspace'
  })
  assert.deepEqual(opened, [{
    contributionId: WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'thread-1'
  }])
})

test('renderer entry keeps command, toolbar, and panel separately owned', () => {
  const entry = createDomainRendererEntry(rendererHost([]))
  assert.deepEqual(
    entry.contributions.map(({ kind, id }) => ({ kind, id })),
    [
      WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
      {
        kind: 'renderer.i18n-resource',
        id: 'create-loop.translations',
        priority: 100
      }
    ].map(({ kind, id }) => ({ kind, id }))
  )
  const toolbar = entry.contributions.find(({ id }) =>
    id === WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  )
  assert.deepEqual(Object.keys(toolbar?.value as object), ['icon'])
  const panel = entry.contributions.find(({ id }) =>
    id === WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )
  assert.deepEqual(Object.keys(panel?.value as object), ['render'])
})

function rendererHost(opened: unknown[]): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not used')
      },
      invoke: async () => {
        throw new Error('not used')
      }
    },
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input) => {
        opened.push(input)
      }
    }
  }
}
