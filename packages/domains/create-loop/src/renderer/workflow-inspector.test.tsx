import assert from 'node:assert/strict'
import test from 'node:test'

import type { WorkflowNodeRunResultV1 } from '../contract.js'
import { parseWorkflowNodePayload } from './workflow/WorkflowNodeRunDetailsPanel.js'
import {
  fitWorkflowDetailsPanelWidth,
  maximumWorkflowDetailsPanelWidth,
  WORKFLOW_DETAILS_PANEL_DEFAULT_WIDTH,
  WORKFLOW_DETAILS_PANEL_MIN_WIDTH
} from './workflow/workflow-details-panel-size.js'
import {
  nextCompletedWorkflowNode,
  panelModeAfterManualNodeSelection
} from './workflow/workflow-inspector-follow.js'

const fingerprint = `sha256:${'0'.repeat(64)}` as `sha256:${string}`

function nodeResult(nodeId: string, finishedAt: string): WorkflowNodeRunResultV1 {
  return {
    nodeId,
    status: 'success',
    startedAt: '2026-08-16T00:00:00.000Z',
    finishedAt,
    message: '',
    outputJson: '{}',
    threadId: '',
    error: '',
    componentFingerprint: fingerprint,
    inputFingerprint: fingerprint,
    outputFingerprint: fingerprint,
    attempts: [],
    artifactRefs: []
  }
}

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
  assert.equal(maximumWorkflowDetailsPanelWidth(900), 420)
  assert.equal(fitWorkflowDetailsPanelWidth(700, 1_200), 700)
  assert.equal(fitWorkflowDetailsPanelWidth(700, 900), 420)
})

test('follows each completed node once even when polling clones live results', () => {
  const firstResults = {
    first: nodeResult('first', '2026-08-16T00:00:01.000Z')
  }
  const first = nextCompletedWorkflowNode(firstResults, '')
  assert.equal(first.nodeId, 'first')

  const repeated = nextCompletedWorkflowNode({ ...firstResults }, first.cursor)
  assert.equal(repeated.nodeId, null)

  const second = nextCompletedWorkflowNode({
    ...firstResults,
    second: nodeResult('second', '2026-08-16T00:00:02.000Z')
  }, repeated.cursor)
  assert.equal(second.nodeId, 'second')
})

test('manual node selection preserves inspection only when the inspector is already active', () => {
  assert.equal(panelModeAfterManualNodeSelection('config'), 'config')
  assert.equal(panelModeAfterManualNodeSelection('run'), 'config')
  assert.equal(panelModeAfterManualNodeSelection('node'), 'node')
})
