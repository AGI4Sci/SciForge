import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION,
  GIT_CHECKPOINTS_LIST_EVAL_CASE_ID,
  GIT_CHECKPOINTS_PREVIEW_CHECKPOINT_ID,
  GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID
} from './capability-eval'

const tempDirs: string[] = []

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('Git Checkpoints capability evaluation exposes all four package-owned checkpoint actions', () => {
  assert.deepEqual(GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION.actionIds, [
      'git-checkpoints.list',
      'git-checkpoints.create',
      'git-checkpoints.preview',
      'git-checkpoints.restore'
  ])
  assert.deepEqual(
    GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds,
    GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION.actionIds
  )
})

test('Git Checkpoints capability evaluation prepares and independently inspects list and preview fixtures', async () => {
    const workspaceDirectory = await mkdtemp(join(tmpdir(), 'sciforge-git-checkpoints-eval-'))
    tempDirs.push(workspaceDirectory)
    const contribution = GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION

    const listContext = {
      caseId: GIT_CHECKPOINTS_LIST_EVAL_CASE_ID,
      runId: 'run-git-checkpoints-list',
      workspaceDirectory,
      userDataDirectory: workspaceDirectory
    }
    const listFixture = await contribution.prepare?.(listContext)
    const listResult = await contribution.inspect?.({
      context: listContext,
      fixture: listFixture,
      invocations: [{ actionId: 'git-checkpoints.list', args: {}, success: true }]
    })
    assert.equal(listResult?.taskSuccess, true)

    const previewWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-git-checkpoints-preview-'))
    tempDirs.push(previewWorkspace)
    const previewContext = {
      caseId: GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID,
      runId: 'run-git-checkpoints-preview',
      workspaceDirectory: previewWorkspace,
      userDataDirectory: previewWorkspace
    }
    const previewFixture = await contribution.prepare?.(previewContext)
    const previewResult = await contribution.inspect?.({
      context: previewContext,
      fixture: previewFixture,
      invocations: [{
        actionId: 'git-checkpoints.preview',
        args: { checkpointId: GIT_CHECKPOINTS_PREVIEW_CHECKPOINT_ID },
        success: true
      }]
    })
    assert.equal(previewResult?.taskSuccess, true)
})
