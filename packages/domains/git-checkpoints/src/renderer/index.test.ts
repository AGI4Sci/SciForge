import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  createGitCheckpointsCommandContribution,
  createGitCheckpointsRightPanelContribution
} from './index.js'

test('renderer exports contract-only surface values and command-based activation', () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input: unknown) => opened.push(input)
    }
  } as unknown as DomainRendererHost
  const panel = createGitCheckpointsRightPanelContribution(host)
  assert.deepEqual(Object.keys(panel), ['render'])

  const command = createGitCheckpointsCommandContribution(host)
  assert.equal(command.isAvailable?.({
    sessionId: 'thread-1',
    workspaceRoot: '/workspace'
  }), true)
  command.execute({
    sessionId: 'thread-1',
    workspaceRoot: '/workspace'
  })
  assert.deepEqual(opened, [{
    contributionId: GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'thread-1'
  }])

  const entry = createDomainRendererEntry(host)
  const installedPanel = entry.contributions.find(
    ({ id }) => id === GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )
  assert.deepEqual(installedPanel?.contract, {
    location: 'workbench.right-panel',
    title: 'Git Checkpoints',
    resourceKind: 'git-checkpoint'
  })
})
