import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CREATE_LOOP_CAPABILITY_EVAL_CONTRIBUTION
} from './capability-eval.js'
import { CREATE_LOOP_CAPABILITY_IDS } from './contract.js'

test('recognizes the canonical approval-denied boundary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sciforge-create-loop-capability-eval-'))
  try {
    const context = {
      caseId: 'core-approval-denied',
      runId: 'eval-run',
      workspaceDirectory: path.join(root, 'workspace'),
      userDataDirectory: path.join(root, 'user-data')
    }
    const fixture = await CREATE_LOOP_CAPABILITY_EVAL_CONTRIBUTION.prepare?.(context)
    const result = await CREATE_LOOP_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context,
      fixture,
      invocations: [{
        actionId: CREATE_LOOP_CAPABILITY_IDS.run,
        args: { workflowId: 'eval-workflow' },
        success: false,
        errorCode: 'approval_denied'
      }]
    })
    await fixture?.cleanup?.()

    assert.equal(result?.taskSuccess, false)
    assert.deepEqual(result?.finalState, {
      approvalDenied: true,
      sideEffectFree: true,
      stateUnchanged: true,
      workspaceUnchanged: true
    })
    assert.deepEqual(result?.verifiedActions, [CREATE_LOOP_CAPABILITY_IDS.run])
    assert.deepEqual(result?.verifiedDimensions, ['artifact_state_correctness'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
