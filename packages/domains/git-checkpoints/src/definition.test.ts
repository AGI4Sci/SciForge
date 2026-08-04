import assert from 'node:assert/strict'
import test from 'node:test'
import {
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchToolbarActionContractSchema
} from '@sciforge/domain-sdk/renderer'
import {
  GIT_CHECKPOINTS_RENDERER_COMMAND_CONTRIBUTION,
  GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRACT,
  GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRACT
} from './definition.js'

test('manifest publishes generic right-panel, command, and toolbar contracts', () => {
  assert.deepEqual(
    domainRendererWorkbenchRightPanelContractSchema.parse(
      GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRACT
    ),
    {
      location: 'workbench.right-panel',
      title: 'Git Checkpoints',
      resourceKind: 'git-checkpoint'
    }
  )
  assert.deepEqual(
    domainRendererWorkbenchToolbarActionContractSchema.parse(
      GIT_CHECKPOINTS_RENDERER_TOOLBAR_ACTION_CONTRACT
    ),
    {
      location: 'workbench.topbar',
      commandId: GIT_CHECKPOINTS_RENDERER_COMMAND_CONTRIBUTION.id,
      label: 'gitCheckpointsToolbar'
    }
  )
  assert.equal(
    GIT_CHECKPOINTS_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind,
    'renderer.workbench-right-panel'
  )
})
