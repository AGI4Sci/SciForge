import assert from 'node:assert/strict'
import test from 'node:test'
import { History, Layers3 } from 'lucide-react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createArtifactVersionsCommandContribution,
  createArtifactVersionsRightPanelContribution,
  createDomainRendererEntry
} from './index.js'

test('renderer installs history panel, command, toolbar, and translations package-locally', () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input: unknown) => opened.push(input)
    }
  } as unknown as DomainRendererHost
  assert.deepEqual(Object.keys(createArtifactVersionsRightPanelContribution(host)), ['render'])

  const command = createArtifactVersionsCommandContribution(host)
  assert.equal(command.isAvailable?.({
    sessionId: 'thread-1',
    workspaceRoot: '/workspace'
  }), true)
  command.execute({ sessionId: 'thread-1', workspaceRoot: '/workspace' })
  assert.deepEqual(opened, [{
    contributionId: ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'thread-1'
  }])

  const entry = createDomainRendererEntry(host)
  const installed = entry.contributions.find(
    ({ id }) => id === ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )
  assert.deepEqual(installed?.contract, {
    location: 'workbench.right-panel',
    title: 'Artifact Versions',
    resourceKind: 'artifact-version'
  })
  const toolbar = entry.contributions.find(
    ({ id }) => id === ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  )
  assert.ok(toolbar && 'icon' in toolbar.value)
  assert.equal(toolbar.value.icon, Layers3)
  assert.notEqual(toolbar.value.icon, History)
  assert.equal(entry.contributions.length, 4)
})
