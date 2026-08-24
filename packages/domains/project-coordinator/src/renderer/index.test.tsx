import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'

import {
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  PROJECT_COORDINATOR_PANEL_SECTION_IDS,
  ProjectCoordinatorPanel
} from './ProjectCoordinatorPanel.js'
import {
  createDomainRendererEntry,
  createProjectCoordinatorOpenCommand
} from './index.js'

test('renderer entry owns one generic Workbench surface without Identity UI contributions', () => {
  const host = rendererHost([])
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ id }) => id),
    [
      PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION.id,
      PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_I18N_CONTRIBUTION.id
    ]
  )
  const panelContribution = entry.contributions.find(
    ({ id }) => id === PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id
  )!
  const panel = panelContribution.value as Readonly<{
    render(input: {
      active: boolean
      focused: boolean
      surfaceId: string
      className: string
      onCollapse(): void
      session: { id: string }
      activation: {
        contributionId: string
        revision: number
        payload: { projectId: string }
      }
    }): ReactElement<Record<string, unknown>>
  }>
  const rendered = panel.render({
    active: true,
    focused: true,
    surfaceId: 'surface-1',
    className: 'fixture-panel',
    onCollapse: () => undefined,
    session: { id: 'session-1' },
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  })
  assert.equal(rendered.props.initialProjectId, 'prj_Project000001')
  assert.equal(rendered.props.className, 'fixture-panel')
})

test('panel surface is limited to Plan, Worker selection, Task, review, and provisioning HCI', () => {
  assert.deepEqual(PROJECT_COORDINATOR_PANEL_SECTION_IDS, [
    'plan',
    'workers',
    'tasks',
    'reviews',
    'provisioning'
  ])
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPanel, {
    client: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-24T09:00:00.000Z',
        projects: []
      })
    },
    session: { id: 'session-1' }
  }))
  for (const sectionId of PROJECT_COORDINATOR_PANEL_SECTION_IDS) {
    assert.match(markup, new RegExp(`data-coordinator-section="${sectionId}"`, 'u'))
  }
  assert.doesNotMatch(markup, /password|access token|refresh token|register agent|enroll device/iu)
})

test('command focuses an exact Project through the generic panel activation contract', () => {
  const opened: unknown[] = []
  const command = createProjectCoordinatorOpenCommand(rendererHost(opened))
  command.execute({
    sessionId: 'session-1',
    payload: { projectId: 'prj_Project000001' }
  })
  assert.deepEqual(opened, [{
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  }])
})

function rendererHost(opened: unknown[]): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => { throw new Error('not observed') },
      invoke: async () => { throw new Error('not invoked') }
    },
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input) => opened.push(input)
    }
  }
}
