import assert from 'node:assert/strict'
import test from 'node:test'

import { parseWorkflowNodePayload } from './workflow/WorkflowNodeRunDetailsPanel.js'
import {
  fitWorkflowDetailsPanelWidth,
  WORKFLOW_DETAILS_PANEL_DEFAULT_WIDTH,
  WORKFLOW_DETAILS_PANEL_MIN_WIDTH
} from './workflow/workflow-details-panel-size.js'

test('parses structured node payloads and preserves plain text', () => {
  assert.deepEqual(parseWorkflowNodePayload('{"tasks":[{"id":"task-1"}]}'), {
    tasks: [{ id: 'task-1' }]
  })
  assert.equal(parseWorkflowNodePayload('plain output'), 'plain output')
  assert.equal(parseWorkflowNodePayload(''), null)
})

test('keeps the inspector readable while preserving canvas space', () => {
  assert.equal(
    fitWorkflowDetailsPanelWidth(WORKFLOW_DETAILS_PANEL_DEFAULT_WIDTH, 1_200),
    WORKFLOW_DETAILS_PANEL_DEFAULT_WIDTH
  )
  assert.equal(
    fitWorkflowDetailsPanelWidth(100, 1_200),
    WORKFLOW_DETAILS_PANEL_MIN_WIDTH
  )
  assert.equal(fitWorkflowDetailsPanelWidth(900, 900), 420)
})
