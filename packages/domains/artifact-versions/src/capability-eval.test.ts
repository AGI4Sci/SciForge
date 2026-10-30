import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION,
  ARTIFACT_VERSIONS_EVAL_CASE_IDS
} from './capability-eval.js'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS } from './contract.js'

test('Artifact Versions capability evaluation exposes all Agent-visible actions', () => {
  assert.deepEqual(ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.actionIds, [
    ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundleV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundleV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.readRangeV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.observe,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew
  ])
  assert.deepEqual(
    ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds,
    ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.actionIds
  )
})

test('Artifact Versions capability evaluation prepares and independently inspects a read fixture', async () => {
  const workspaceDirectory = await mkdtemp(join(tmpdir(), 'sciforge-artifact-versions-eval-'))
  try {
    const context = {
      caseId: ARTIFACT_VERSIONS_EVAL_CASE_IDS.read,
      runId: 'run-artifact-versions-read',
      workspaceDirectory,
      userDataDirectory: workspaceDirectory
    }
    const fixture = await ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.prepare?.(context)
    assert.ok(fixture)
    const result = await ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context,
      fixture,
      invocations: [{
        actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
        args: { versionId: 'artifact-version:eval-v2' },
        success: true
      }]
    })
    assert.equal(result?.taskSuccess, true)
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})

test('Artifact Versions capability evaluation inspects the successful retry, not the failed first attempt', async () => {
  const workspaceDirectory = await mkdtemp(join(tmpdir(), 'sciforge-artifact-versions-retry-eval-'))
  try {
    const context = {
      caseId: ARTIFACT_VERSIONS_EVAL_CASE_IDS.compare,
      runId: 'run-artifact-versions-compare-retry',
      workspaceDirectory,
      userDataDirectory: workspaceDirectory
    }
    const fixture = await ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.prepare?.(context)
    assert.ok(fixture)
    const result = await ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION.inspect?.({
      context,
      fixture,
      invocations: [
        {
          actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
          args: { left: 'artifact-version:eval-v1', right: 'artifact-version:eval-v2' },
          success: false,
          errorCode: 'invalid_input'
        },
        {
          actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
          args: {
            fromVersionId: 'artifact-version:eval-v1',
            toVersionId: 'artifact-version:eval-v2'
          },
          success: true,
          output: { ok: true, value: { sameContent: false } }
        }
      ]
    })
    assert.equal(result?.taskSuccess, true)
    assert.deepEqual(result?.verifiedActions, [ARTIFACT_VERSIONS_CAPABILITY_IDS.compare])
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
})
