import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainRendererHost,
  DomainWorkbenchOpenRightPanelInput
} from '@sciforge/domain-sdk/host'

import {
  createProjectCoordinatorNavigationSectionContribution
} from './index.js'

test('pending activation opens the Project workflow through the renderer command', () => {
  const projectId = 'prj_aaaaaaaaaaaa'
  const coordinatorSessionId = 'coordinator-session'
  let selectedSessionId: string | undefined
  let openedPanel: DomainWorkbenchOpenRightPanelInput | undefined

  const host: DomainRendererHost = {
    capabilityInvoker: {} as DomainRendererHost['capabilityInvoker'],
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input) => {
        openedPanel = input
      }
    }
  }
  const contribution = createProjectCoordinatorNavigationSectionContribution(host)
  const rendered = contribution.render({
    active: true,
    className: '',
    session: { id: 'current-session' },
    sessions: [{
      id: coordinatorSessionId,
      runtimeId: 'runtime-1',
      title: 'Coordinator',
      updatedAt: '2026-08-30T00:00:00.000Z'
    }],
    selectSession: (sessionId) => {
      selectedSessionId = sessionId
    }
  })
  const props = (rendered as unknown as {
    props: Readonly<{
      onActivateProject: (projectId: string, sessionId: string) => void
    }>
  }).props

  assert.doesNotThrow(() => props.onActivateProject(projectId, coordinatorSessionId))
  assert.equal(selectedSessionId, coordinatorSessionId)
  assert.equal(openedPanel?.sessionId, coordinatorSessionId)
  assert.equal(openedPanel?.activation?.payload && (
    openedPanel.activation.payload as { view?: unknown }
  ).view, 'tasks')
})
