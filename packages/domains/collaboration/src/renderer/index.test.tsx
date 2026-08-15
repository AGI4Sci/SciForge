import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'

import {
  COLLABORATION_I18N_CONTRIBUTION,
  COLLABORATION_OPEN_COMMAND_CONTRIBUTION,
  COLLABORATION_RIGHT_PANEL_CONTRACT,
  COLLABORATION_RIGHT_PANEL_CONTRIBUTION,
  COLLABORATION_TOOLBAR_ACTION_CONTRACT,
  COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createCollaborationOpenCommand,
  createDomainRendererEntry,
  type CollaborationRightPanelContribution
} from './index.js'

test('renderer entry owns panel, command, toolbar, and translations', () => {
  const host = rendererHost([])
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ kind, id }) => ({ kind, id })),
    [
      COLLABORATION_RIGHT_PANEL_CONTRIBUTION,
      COLLABORATION_OPEN_COMMAND_CONTRIBUTION,
      COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION,
      COLLABORATION_I18N_CONTRIBUTION
    ].map(({ kind, id }) => ({ kind, id }))
  )

  const panelRuntime = entry.contributions.find(({ id }) =>
    id === COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id
  )!
  assert.deepEqual(panelRuntime.contract, COLLABORATION_RIGHT_PANEL_CONTRACT)
  const panel = panelRuntime.value as CollaborationRightPanelContribution
  const rendered = panel.render({
    active: true,
    className: 'fixture-panel',
    onCollapse: () => undefined,
    session: { id: 'thread-1', runtimeId: 'codex' }
  }) as ReactElement<Record<string, unknown>>
  assert.equal(rendered.props.className, 'fixture-panel')
  assert.deepEqual(rendered.props.session, { id: 'thread-1', runtimeId: 'codex' })
  assert.equal(typeof rendered.props.client, 'object')

  const toolbar = entry.contributions.find(({ id }) =>
    id === COLLABORATION_TOOLBAR_ACTION_CONTRIBUTION.id
  )!
  assert.deepEqual(toolbar.contract, COLLABORATION_TOOLBAR_ACTION_CONTRACT)
  assert.deepEqual(Object.keys(toolbar.value as object), ['icon'])

  const translations = entry.contributions.find(({ id }) =>
    id === COLLABORATION_I18N_CONTRIBUTION.id
  )!.value as { resources: { zh: Record<string, string> } }
  assert.equal(translations.resources.zh.collaborationTitle, '协作')
})

test('command opens without requiring a Project or workspace', () => {
  const opened: unknown[] = []
  const command = createCollaborationOpenCommand(rendererHost(opened))
  assert.equal(command.isAvailable?.({ sessionId: 'thread-1' }), true)
  assert.equal(command.isAvailable?.({}), false)
  command.execute({ sessionId: 'thread-1' })
  assert.deepEqual(opened, [{
    contributionId: COLLABORATION_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'thread-1'
  }])
})

function rendererHost(opened: unknown[]): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not observed')
      },
      invoke: async () => {
        throw new Error('not invoked')
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
